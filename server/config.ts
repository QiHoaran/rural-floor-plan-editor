import path from 'node:path';

export interface ServerConfig {
  projectRoot: string;
  dataRoot: string;
  port: number;
  development: boolean;
}

export function createServerConfig(
  projectRoot = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): ServerConfig {
  return {
    projectRoot,
    dataRoot: path.resolve(projectRoot, env.RURAL_DATA_ROOT ?? 'data'),
    port: Number(env.PORT ?? 4173),
    development: env.NODE_ENV !== 'production',
  };
}
