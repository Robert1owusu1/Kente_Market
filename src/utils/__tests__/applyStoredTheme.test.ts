// The theme class must be right before the first render (no dark->light flash).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const load = async () => {
  vi.resetModules();
  await import('../applyStoredTheme');
};

describe('applyStoredTheme', () => {
  beforeEach(() => document.documentElement.classList.add('dark'));

  it('removes dark for the default (no saved theme) and for a saved light theme', async () => {
    vi.mocked(localStorage.getItem).mockReturnValue(null);
    await load();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    vi.mocked(localStorage.getItem).mockReturnValue('light');
    document.documentElement.classList.add('dark');
    await load();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('keeps dark for a saved dark theme', async () => {
    vi.mocked(localStorage.getItem).mockReturnValue('dark');
    await load();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
