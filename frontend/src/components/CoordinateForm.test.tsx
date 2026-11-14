import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Geometry } from '../api/types';
import { boundsOf } from '../geo/geometry';
import { areaKm2 } from '../geo/shapes';
import { CoordinateForm } from './CoordinateForm';

const steppe: Geometry = {
  type: 'Polygon',
  coordinates: [
    [
      [61, 51],
      [71, 51],
      [71, 55],
      [61, 55],
      [61, 51],
    ],
  ],
};

describe('CoordinateForm', () => {
  it('prefills the bounds of the current area', () => {
    render(<CoordinateForm geometry={steppe} onSubmit={() => {}} onCancel={() => {}} />);

    expect(screen.getByLabelText('West')).toHaveValue('61');
    expect(screen.getByLabelText('South')).toHaveValue('51');
    expect(screen.getByLabelText('East')).toHaveValue('71');
    expect(screen.getByLabelText('North')).toHaveValue('55');
  });

  it('submits a rectangle built from the bounds', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<CoordinateForm geometry={null} onSubmit={onSubmit} onCancel={() => {}} />);

    await user.type(screen.getByLabelText('West'), '-62');
    await user.type(screen.getByLabelText('South'), '-13');
    await user.type(screen.getByLabelText('East'), '-52');
    await user.type(screen.getByLabelText('North'), '-7');
    await user.click(screen.getByRole('button', { name: 'Show area' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(boundsOf(onSubmit.mock.calls[0][0] as Geometry)).toEqual({
      west: -62,
      south: -13,
      east: -52,
      north: -7,
    });
  });

  it('says what to fix, marks the field and moves focus to it', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<CoordinateForm geometry={null} onSubmit={onSubmit} onCancel={() => {}} />);

    await user.type(screen.getByLabelText('West'), '20');
    await user.type(screen.getByLabelText('South'), '0');
    await user.type(screen.getByLabelText('East'), '10');
    await user.type(screen.getByLabelText('North'), '5');
    await user.click(screen.getByRole('button', { name: 'Show area' }));

    expect(screen.getByRole('alert')).toHaveTextContent('East must be greater than West.');
    const east = screen.getByLabelText('East');
    expect(east).toHaveAttribute('aria-invalid', 'true');
    expect(east).toHaveFocus();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('builds a circle from a point and a radius', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<CoordinateForm geometry={null} onSubmit={onSubmit} onCancel={() => {}} />);

    await user.click(screen.getByRole('radio', { name: 'Point and radius' }));
    await user.type(screen.getByLabelText('Latitude'), '53');
    await user.type(screen.getByLabelText('Longitude'), '67');
    await user.type(screen.getByLabelText('Radius, km'), '100');
    await user.click(screen.getByRole('button', { name: 'Show area' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const circle = onSubmit.mock.calls[0][0] as Geometry;
    const expected = Math.PI * 100 ** 2;
    expect(Math.abs(areaKm2(circle) - expected) / expected).toBeLessThan(0.01);
  });

  it('clears the message when the way of setting the area changes', async () => {
    const user = userEvent.setup();
    render(<CoordinateForm geometry={null} onSubmit={() => {}} onCancel={() => {}} />);

    await user.click(screen.getByRole('button', { name: 'Show area' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a number for West.');

    await user.click(screen.getByRole('radio', { name: 'Point and radius' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('cancels without submitting', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    render(<CoordinateForm geometry={steppe} onSubmit={onSubmit} onCancel={onCancel} />);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
