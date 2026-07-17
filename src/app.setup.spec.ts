import { getWebOrigins } from './app.setup';

describe('getWebOrigins', () => {
  it('uses localhost by default', () => {
    expect(getWebOrigins(undefined)).toEqual(['http://localhost:3000']);
  });

  it('parses comma-separated origins', () => {
    expect(
      getWebOrigins('https://resume-ai-web.vercel.app, http://localhost:3000'),
    ).toEqual(['https://resume-ai-web.vercel.app', 'http://localhost:3000']);
  });
});
