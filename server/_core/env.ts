export const ENV = {
  appId: process.env.MANUS_PROJECT_ID ?? process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.MANUS_JWT_SECRET ?? process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.MANUS_OAUTH_API_URL ?? process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  githubToken: process.env.RECODER_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN ?? "",
  githubRepository: process.env.RECODER_GITHUB_REPOSITORY ?? "",
  githubBranch: process.env.RECODER_GITHUB_BRANCH ?? "main",
  githubWorkspacePath: process.env.RECODER_GITHUB_WORKSPACE_PATH ?? ".recoder/workspace.json",
};
