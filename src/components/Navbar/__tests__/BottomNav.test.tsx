// The Try-On tab appears only while the server has AI try-on switched on;
// while it is off the tab would open a page that only says it is offline.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';

let enabled = false;
vi.mock('../../../slices/tryOnApiSlice', () => ({ useTryOnEnabled: () => enabled }));
vi.mock('../../../Context/CartContext', () => ({ useCart: () => ({ cartItems: [] }) }));

import BottomNav from '../BottomNav';

const renderNav = () => render(<MemoryRouter><BottomNav /></MemoryRouter>);

describe('BottomNav try-on tab', () => {
  beforeEach(() => { enabled = false; });

  it('is hidden while AI try-on is off', () => {
    renderNav();
    expect(screen.queryByText('Try-On')).not.toBeInTheDocument();
    expect(screen.getByText('Products')).toBeInTheDocument();
  });

  it('is shown once AI try-on is on', () => {
    enabled = true;
    renderNav();
    expect(screen.getByText('Try-On').closest('a')).toHaveAttribute('href', '/ai-tryon');
  });
});
