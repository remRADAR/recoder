import type { AgentRuntimeEvent } from "./runtime";
import { createDefaultCapabilityRegistry, type CapabilityDescriptor, type CapabilityRegistry, type CapabilitySurface } from "./capabilities";

export type GovernedPhase = "draft" | "awaiting_approval" | "applying" | "verifying" | "completed" | "failed" | "cancelled";
export type GovernedOperation = {
  id: string;
  capabilityId: string;
  summary: string;
  resource?: string;
  input?: unknown;
  requiresApproval?: boolean;
  approved?: boolean;
};
export type GovernedPlan = { id: string; task: string; agentId: string; operations: GovernedOperation[] };
export type GovernedTaskState = {
  plan: GovernedPlan;
  phase: GovernedPhase;
  completedOperationIds: string[];
  approvedOperationIds: string[];
  error: string | null;
  events: AgentRuntimeEvent[];
};
export type GovernedTaskExecutor = (operation: GovernedOperation) => Promise<void>;
export type GovernedTaskVerifier = (plan: GovernedPlan) => Promise<void>;
export type GovernedApprovalRequest = { operation: GovernedOperation; capability: CapabilityDescriptor };

export async function requestGovernedApproval(input: {
  operation: GovernedOperation;
  surface: CapabilitySurface;
  registry?: CapabilityRegistry;
  approve?: (request: GovernedApprovalRequest) => Promise<boolean>;
}): Promise<boolean> {
  const registry = input.registry ?? createDefaultCapabilityRegistry();
  const capability = registry.get(input.operation.capabilityId);
  if (!capability) throw new Error(`Unknown capability: ${input.operation.capabilityId}`);
  if (!capability.enabled) throw new Error(`Capability is disabled: ${input.operation.capabilityId}`);
  if (!capability.availability.includes("all") && !capability.availability.includes(input.surface)) throw new Error(`Capability unavailable on ${input.surface}: ${input.operation.capabilityId}`);
  if (!(input.operation.requiresApproval ?? capability.requiresApproval)) return true;
  if (!input.approve) return false;
  return input.approve({ operation: { ...input.operation, requiresApproval: true }, capability });
}

function event(events: AgentRuntimeEvent[], kind: AgentRuntimeEvent["kind"], text: string, onEvent?: (value: AgentRuntimeEvent) => void) {
  const next = { id: events.length + 1, kind, text, at: Date.now() };
  events.push(next);
  onEvent?.(next);
}

export function createGovernedTask(input: {
  plan: GovernedPlan;
  surface: CapabilitySurface;
  registry?: CapabilityRegistry;
  execute: GovernedTaskExecutor;
  verify?: GovernedTaskVerifier;
  onEvent?: (event: AgentRuntimeEvent) => void;
}) {
  const registry = input.registry ?? createDefaultCapabilityRegistry();
  const operations = input.plan.operations.map((operation) => {
    const capability = registry.get(operation.capabilityId);
    if (!capability) throw new Error(`Unknown capability: ${operation.capabilityId}`);
    if (!capability.enabled) throw new Error(`Capability is disabled: ${operation.capabilityId}`);
    if (!capability.availability.includes("all") && !capability.availability.includes(input.surface)) throw new Error(`Capability unavailable on ${input.surface}: ${operation.capabilityId}`);
    const needsApproval = operation.requiresApproval ?? capability.requiresApproval;
    return { ...operation, requiresApproval: needsApproval, approved: !needsApproval };
  });
  const plan = { ...input.plan, operations };
  const state: GovernedTaskState = { plan, phase: "draft", completedOperationIds: [], approvedOperationIds: operations.filter((operation) => operation.approved).map((operation) => operation.id), error: null, events: [] };
  let cancelled = false;

  const emit = (kind: AgentRuntimeEvent["kind"], text: string) => event(state.events, kind, text, input.onEvent);
  const getState = () => ({ ...state, plan: { ...state.plan, operations: state.plan.operations.map((operation) => ({ ...operation })) }, completedOperationIds: [...state.completedOperationIds], approvedOperationIds: [...state.approvedOperationIds], events: [...state.events] });

  const approve = (operationIds: string[] = state.plan.operations.filter((operation) => operation.requiresApproval).map((operation) => operation.id)) => {
    if (state.phase !== "draft" && state.phase !== "awaiting_approval") throw new Error(`Cannot approve a task in ${state.phase} phase.`);
    const allowed = new Set(operationIds);
    state.plan.operations = state.plan.operations.map((operation) => allowed.has(operation.id) ? { ...operation, approved: true } : operation);
    state.approvedOperationIds = state.plan.operations.filter((operation) => operation.approved).map((operation) => operation.id);
    state.phase = state.plan.operations.some((operation) => operation.requiresApproval && !operation.approved) ? "awaiting_approval" : "draft";
    emit("status", state.phase === "awaiting_approval" ? "More operation approvals are required." : "All planned operations are approved.");
    return getState();
  };

  const cancel = () => {
    if (["completed", "failed", "cancelled"].includes(state.phase)) return getState();
    cancelled = true;
    state.phase = "cancelled";
    emit("status", "Task cancelled before completion.");
    return getState();
  };

  const run = async () => {
    if (cancelled || state.phase === "cancelled") return getState();
    if (state.plan.operations.some((operation) => operation.requiresApproval && !operation.approved)) {
      state.phase = "awaiting_approval";
      emit("status", "Task is waiting for approval before changing files or executing code.");
      return getState();
    }
    state.phase = "applying";
    emit("status", "Applying approved agent operations.");
    try {
      for (const operation of state.plan.operations) {
        if (cancelled) return cancel();
        emit("tool", `${operation.capabilityId}${operation.resource ? ` · ${operation.resource}` : ""}`);
        await input.execute(operation);
        state.completedOperationIds.push(operation.id);
      }
      state.phase = "verifying";
      emit("status", "Verifying the completed agent task.");
      await input.verify?.(state.plan);
      state.phase = "completed";
      emit("status", "Governed task completed and verified.");
    } catch (error) {
      state.phase = "failed";
      state.error = error instanceof Error ? error.message : "Governed task failed.";
      emit("error", state.error);
    }
    return getState();
  };

  return { getState, approve, run, cancel };
}
