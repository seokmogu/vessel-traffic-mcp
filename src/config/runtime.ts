export interface RuntimeConfig {
  transport: 'stdio';
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const transport = env.VESSEL_MCP_TRANSPORT ?? 'stdio';

  if (transport !== 'stdio') {
    throw new Error(`Unsupported VESSEL_MCP_TRANSPORT "${transport}". F1.AC1 currently supports "stdio" only.`);
  }

  return { transport };
}
