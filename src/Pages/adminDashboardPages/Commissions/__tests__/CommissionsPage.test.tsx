// COM-1: the API reads `targetId`. The page used to post `target`, so every
// category/vendor/product rule created from the dashboard was rejected with
// 400, and the list showed "—" for every target.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const createMock = vi.fn();
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock('react-toastify', () => ({ toast: toastMock }));

const rules = [
  { id: 1, scope: 'global', targetId: null, rate: 0.1, priority: 0, isActive: 1, created_at: '2026-10-12T10:00:00Z' },
  { id: 2, scope: 'category', targetId: 'Adweneasa', rate: 0.125, priority: 0, isActive: 1, created_at: '2026-10-12T10:00:00Z' },
];

vi.mock('../../../../slices/marketplaceApiSlice', () => ({
  useGetCommissionRulesQuery: () => ({ data: rules, isLoading: false, isError: false }),
  useCreateCommissionRuleMutation: () => [createMock, { isLoading: false }],
  useDeleteCommissionRuleMutation: () => [vi.fn(), { isLoading: false }],
}));

const { default: CommissionsPage } = await import('../CommissionsPage');

describe('CommissionsPage', () => {
  beforeEach(() => {
    createMock.mockReset();
    createMock.mockReturnValue({ unwrap: () => Promise.resolve({}) });
    toastMock.success.mockReset();
    toastMock.error.mockReset();
  });

  it('shows each rule target from targetId', () => {
    render(<CommissionsPage />);
    expect(screen.getByText('Adweneasa')).toBeInTheDocument();
    expect(screen.getByText('12.5%')).toBeInTheDocument();
  });

  it('creates a category rule with the field the API reads (targetId)', async () => {
    const { container } = render(<CommissionsPage />);
    fireEvent.click(screen.getByText(/New rule/));
    fireEvent.change(container.querySelector('select') as HTMLSelectElement, { target: { value: 'category' } });
    fireEvent.change(container.querySelector('input[type="text"]') as HTMLInputElement, { target: { value: ' Adweneasa ' } });
    fireEvent.change(container.querySelector('input[type="number"]') as HTMLInputElement, { target: { value: '0.125' } });
    fireEvent.click(screen.getByText(/Create rule/));
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock).toHaveBeenCalledWith({ scope: 'category', targetId: 'Adweneasa', rate: 0.125 });
    expect(createMock.mock.calls[0][0]).not.toHaveProperty('target');
  });
});
