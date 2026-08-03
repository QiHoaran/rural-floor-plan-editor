// @vitest-environment node

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createServerConfig } from '../../server/config.ts';

describe('createServerConfig', () => {
  it('allows tests to isolate project data outside the repository data directory', () => {
    const projectRoot = path.resolve('D:/project');
    const config = createServerConfig(projectRoot, {
      RURAL_DATA_ROOT: 'test-results/e2e-data',
    });

    expect(config.dataRoot).toBe(
      path.resolve(projectRoot, 'test-results/e2e-data'),
    );
  });
});
