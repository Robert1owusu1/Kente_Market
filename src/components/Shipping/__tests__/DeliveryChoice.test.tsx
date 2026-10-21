// Sellers choose who delivers, separately for Ghana and abroad.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import DeliveryChoice from '../DeliveryChoice';

describe('DeliveryChoice', () => {
  it('shows both choices for Ghana and abroad, with the current one checked', () => {
    render(<DeliveryChoice value={{ domesticDelivery: 'seller', internationalDelivery: 'platform' }} onChange={() => {}} />);
    const ghana = screen.getByRole('group', { name: /within Ghana/i });
    const abroad = screen.getByRole('group', { name: /outside Ghana/i });
    expect(within(ghana).getByRole('radio', { name: /I deliver/i })).toBeChecked();
    expect(within(abroad).getByRole('radio', { name: /platform delivers/i })).toBeChecked();
    expect(screen.getAllByText(/drop the parcel at our hub/i)).toHaveLength(2);
  });

  it('reports the scope and value picked', () => {
    const onChange = vi.fn();
    render(<DeliveryChoice value={{}} onChange={onChange} />);
    fireEvent.click(within(screen.getByRole('group', { name: /outside Ghana/i })).getByRole('radio', { name: /platform delivers/i }));
    expect(onChange).toHaveBeenCalledWith('internationalDelivery', 'platform');
  });
});
