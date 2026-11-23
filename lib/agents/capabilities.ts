export type CapabilitySurface = "web" | "native" | "server";
export type CapabilityKind = "workspace" | "runtime" | "verification" | "mcp" | "extension";
export type CapabilityRisk = "read" | "write" | "execute" | "network";

export type CapabilityDescriptor = {
  id: string;
  label: string;
  description: string;
  kind: CapabilityKind;
  source: "builtin" | "open-source";
  availability: Array<CapabilitySurface | "all">;
  permissions: string[];
  risk: CapabilityRisk;
  requiresApproval: boolean;
  enabled: boolean;
  projectUrl?: string;
};

export class CapabilityRegistry {
  private readonly capabilities = new Map<string, CapabilityDescriptor>();

  register(capability: CapabilityDescriptor): this {
    if (!capability.id.trim()) throw new Error("Capability id is required.");
    if (this.capabilities.has(capability.id)) throw new Error(`Capability already registered: ${capability.id}`);
    this.capabilities.set(capability.id, { ...capability, permissions: [...capability.permissions], availability: [...capability.availability] });
    return this;
  }

  get(id: string): CapabilityDescriptor | undefined {
    const capability = this.capabilities.get(id);
    return capability ? { ...capability, permissions: [...capability.permissions], availability: [...capability.availability] } : undefined;
  }

  list(filter?: { kind?: CapabilityKind; source?: CapabilityDescriptor["source"]; enabled?: boolean }): CapabilityDescriptor[] {
    return [...this.capabilities.values()].filter((capability) => filter?.kind ? capability.kind === filter.kind : true).filter((capability) => filter?.source ? capability.source === filter.source : true).filter((capability) => filter?.enabled === undefined ? true : capability.enabled === filter.enabled).map((capability) => this.get(capability.id) as CapabilityDescriptor);
  }
}

export function createDefaultCapabilityRegistry(): CapabilityRegistry {
  return new CapabilityRegistry()
    .register({ id: "recoder.workspace.read", label: "Read workspace", description: "Inspect files and project metadata in the active workspace.", kind: "workspace", source: "builtin", availability: ["all"], permissions: ["workspace.read"], risk: "read", requiresApproval: false, enabled: true })
    .register({ id: "recoder.workspace.write", label: "Edit workspace", description: "Create a proposed file mutation in the active workspace.", kind: "workspace", source: "builtin", availability: ["all"], permissions: ["workspace.write"], risk: "write", requiresApproval: true, enabled: true })
    .register({ id: "recoder.runtime.run", label: "Run project code", description: "Execute a selected project entry through a bounded runtime.", kind: "runtime", source: "builtin", availability: ["native", "server"], permissions: ["runtime.execute"], risk: "execute", requiresApproval: true, enabled: true })
    .register({ id: "recoder.verification.checks", label: "Run verification checks", description: "Run configured project checks and return bounded output.", kind: "verification", source: "builtin", availability: ["server", "native"], permissions: ["verification.run"], risk: "execute", requiresApproval: true, enabled: true })
    .register({ id: "recoder.mcp.invoke", label: "Invoke an MCP capability", description: "Call a registered MCP tool after its provider and permission policy are approved.", kind: "mcp", source: "open-source", availability: ["server", "native"], permissions: ["mcp.invoke"], risk: "network", requiresApproval: true, enabled: false })
    .register({ id: "recoder.extension.apply", label: "Apply an open-source extension", description: "Apply a registered formatter, linter, generator, or editor extension to the workspace.", kind: "extension", source: "open-source", availability: ["web", "native", "server"], permissions: ["extension.apply"], risk: "write", requiresApproval: true, enabled: false });
}
