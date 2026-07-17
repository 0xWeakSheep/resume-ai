import {
  getWebOriginPatterns,
  getWebOrigins,
  isWebOriginAllowed,
} from './app.setup';

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

describe('getWebOriginPatterns', () => {
  it('parses comma-separated regex patterns', () => {
    const patterns = getWebOriginPatterns(
      '^https://resume-ai-web(?:-[a-z0-9-]+)?-0xweaksheep[.]vercel[.]app$',
    );

    expect(patterns).toHaveLength(1);
    expect(
      patterns[0].test('https://resume-ai-web-git-main-0xweaksheep.vercel.app'),
    ).toBe(true);
  });
});

describe('isWebOriginAllowed', () => {
  const exactOrigins = ['https://resume-ai-web.vercel.app'];
  const originPatterns = getWebOriginPatterns(
    '^https://resume-ai-web(?:-[a-z0-9-]+)?-0xweaksheep[.]vercel[.]app$',
  );

  it('allows requests without browser origin', () => {
    expect(isWebOriginAllowed(undefined, exactOrigins, originPatterns)).toBe(
      true,
    );
  });

  it('allows explicitly configured origins', () => {
    expect(
      isWebOriginAllowed(
        'https://resume-ai-web.vercel.app',
        exactOrigins,
        originPatterns,
      ),
    ).toBe(true);
  });

  it('allows the project Vercel preview origin', () => {
    expect(
      isWebOriginAllowed(
        'https://resume-ai-web-git-main-0xweaksheep.vercel.app',
        exactOrigins,
        originPatterns,
      ),
    ).toBe(true);
  });

  it('rejects unrelated Vercel origins', () => {
    expect(
      isWebOriginAllowed(
        'https://resume-ai-web-git-main-unknown.vercel.app',
        exactOrigins,
        originPatterns,
      ),
    ).toBe(false);
    expect(
      isWebOriginAllowed(
        'https://evil.vercel.app',
        exactOrigins,
        originPatterns,
      ),
    ).toBe(false);
  });
});
