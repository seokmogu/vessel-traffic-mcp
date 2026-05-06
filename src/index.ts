export const projectName = 'vessel-traffic-mcp';

export function describeScaffold(): string {
  return `${projectName}: MCP server scaffold. Implementation tasks are tracked in docs/autodev/requirements.yaml.`;
}

export function main(): void {
  console.log(describeScaffold());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

