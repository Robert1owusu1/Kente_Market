// The SPA only forwards a well-formed ?ref= code to the server once; it never
// stores it in browser storage or sends a referrer id.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const captureMock = vi.fn(() => ({ catch: () => undefined }));
vi.mock('../../../slices/referralsApiSlice', () => ({
  useCaptureReferralVisitMutation: () => [captureMock],
}));
const { default: ReferralCapture } = await import('../ReferralCapture');

const at = (url: string) => render(<MemoryRouter initialEntries={[url]}><ReferralCapture /></MemoryRouter>);

describe('ReferralCapture', () => {
  beforeEach(() => captureMock.mockClear());

  it('sends a valid code once', () => {
    const { rerender } = at('/?ref=abcdefgh');
    rerender(<MemoryRouter initialEntries={['/?ref=abcdefgh']}><ReferralCapture /></MemoryRouter>);
    expect(captureMock).toHaveBeenCalledTimes(1);
    expect(captureMock).toHaveBeenCalledWith('ABCDEFGH');
  });

  it('ignores malformed codes and pages without ?ref', () => {
    const setItem = vi.spyOn(window.localStorage, 'setItem');
    at('/?ref=<script>');
    at('/?ref=ABC');
    at('/products');
    expect(captureMock).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });
});
