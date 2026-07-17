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
      '^https://resume-ai-web[a-z0-9-]*[.]vercel[.]app$,^http://(localhost|127[.]0[.]0[.]1):300[0-9]$',
    );

    expect(patterns).toHaveLength(2);
    expect(
      patterns[0].test('https://resume-ai-web-git-main-0xweaksheep.vercel.app'),
    ).toBe(true);
    expect(patterns[1].test('http://localhost:3001')).toBe(true);
  });
});

describe('isWebOriginAllowed', () => {
  const exactOrigins = ['https://resume-ai-web.vercel.app'];
  const originPatterns = getWebOriginPatterns(
    '^https://resume-ai-web[a-z0-9-]*[.]vercel[.]app$,^http://(localhost|127[.]0[.]0[.]1):300[0-9]$',
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

  it('allows common Vercel generated project origins', () => {
    expect(
      isWebOriginAllowed(
        'https://resume-ai-web-git-main-0xweaksheeps-projects.vercel.app',
        exactOrigins,
        originPatterns,
      ),
    ).toBe(true);
    expect(
      isWebOriginAllowed(
        'https://resume-ai-web-7s9x4f2a-0xweaksheep.vercel.app',
        exactOrigins,
        originPatterns,
      ),
    ).toBe(true);
  });

  it('allows common local Next.js dev origins', () => {
    expect(
      isWebOriginAllowed('http://localhost:3001', exactOrigins, originPatterns),
    ).toBe(true);
    expect(
      isWebOriginAllowed('http://127.0.0.1:3002', exactOrigins, originPatterns),
    ).toBe(true);
  });

  it('rejects unrelated Vercel origins', () => {
    expect(
      isWebOriginAllowed(
        'https://other-resume-ai-web.vercel.app',
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
