import { createSign } from 'node:crypto';

export function createGitHubAppJwt(input: { appId: string; privateKey: string; now?: Date }): string {
  const nowSeconds = Math.floor((input.now?.getTime() ?? Date.now()) / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iat: nowSeconds - 60,
    exp: nowSeconds + 9 * 60,
    iss: input.appId,
  };
  const unsigned = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(input.privateKey);
  return `${unsigned}.${base64Url(signature)}`;
}

function base64UrlJson(value: unknown): string {
  return base64Url(Buffer.from(JSON.stringify(value)));
}

function base64Url(value: Buffer): string {
  return value.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
