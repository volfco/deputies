import { randomUUID } from 'node:crypto';
import { createArtifactObjectStorage } from '../../src/artifacts/storage.js';
import { loadConfig } from '../../src/config/index.js';

const seaweedfsEndpoint = process.env.ARTIFACT_STORAGE_S3_ENDPOINT;

describe.skipIf(!seaweedfsEndpoint)('real SeaweedFS artifact storage UAT', () => {
  it('stores objects and supports ranged reads through the S3 API', async () => {
    const storage = createArtifactObjectStorage(
      loadConfig({
        ...process.env,
        API_AUTH_MODE: process.env.API_AUTH_MODE ?? 'none',
        ARTIFACT_STORAGE_PROVIDER: 's3',
        ARTIFACT_STORAGE_S3_ENDPOINT: seaweedfsEndpoint,
        ARTIFACT_STORAGE_S3_REGION: process.env.ARTIFACT_STORAGE_S3_REGION ?? 'us-east-1',
        ARTIFACT_STORAGE_S3_BUCKET: process.env.ARTIFACT_STORAGE_S3_BUCKET ?? 'deputies-artifacts',
        ARTIFACT_STORAGE_S3_ACCESS_KEY_ID: process.env.ARTIFACT_STORAGE_S3_ACCESS_KEY_ID ?? 'seaweed',
        ARTIFACT_STORAGE_S3_SECRET_ACCESS_KEY: process.env.ARTIFACT_STORAGE_S3_SECRET_ACCESS_KEY ?? 'seaweed',
        ARTIFACT_STORAGE_S3_FORCE_PATH_STYLE: process.env.ARTIFACT_STORAGE_S3_FORCE_PATH_STYLE ?? 'true',
        ARTIFACT_STORAGE_S3_CREATE_BUCKET: process.env.ARTIFACT_STORAGE_S3_CREATE_BUCKET ?? 'true',
      }),
    );
    const key = `uat/range-${randomUUID()}.txt`;
    const body = new TextEncoder().encode('abcdefghijklmnopqrstuvwxyz');

    await storage.put({ key, body, contentType: 'text/plain' });
    const full = await storage.get(key);
    const range = await storage.getRange?.(key, 0, 4);

    expect(new TextDecoder().decode(full?.body)).toBe('abcdefghijklmnopqrstuvwxyz');
    expect(new TextDecoder().decode(range?.body)).toBe('abcde');
  });
});
