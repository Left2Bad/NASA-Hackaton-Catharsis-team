import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Geometry } from '../api/types';
import type { AreaMapEngine, AreaMapHandlers } from '../map/engine';
import { AreaMap } from './AreaMap';

// The real engine needs WebGL, which the test environment does not have.
// A fake engine records the calls and lets a test play the part of the user drawing.
const engineMock = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock('../map/engine', () => ({
  createAreaMapEngine: engineMock.create,
}));

const square: Geometry = {
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

function fakeEngine() {
  const engine: AreaMapEngine = {
    setTool: vi.fn(),
    showArea: vi.fn(),
    setSatellite: vi.fn(),
    showPoints: vi.fn(),
    destroy: vi.fn(),
  };
  let handlers: AreaMapHandlers | undefined;
  engineMock.create.mockImplementation((_container: HTMLElement, given: AreaMapHandlers) => {
    handlers = given;
    return Promise.resolve(engine);
  });
  return {
    engine,
    handlers: () => {
      if (!handlers) throw new Error('The engine has not been created yet');
      return handlers;
    },
  };
}

beforeEach(() => {
  engineMock.create.mockReset();
});

describe('AreaMap', () => {
  it('shows the drawing tools once the map is ready', async () => {
    fakeEngine();
    render(<AreaMap geometry={null} onChange={() => {}} />);

    expect(screen.getByText('Loading the map…')).toBeInTheDocument();
    const toolbar = await screen.findByRole('toolbar', { name: 'Map tools' });
    expect(toolbar).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
  });

  it('switches the drawing tool and releases it on a second press', async () => {
    const user = userEvent.setup();
    const { engine } = fakeEngine();
    render(<AreaMap geometry={null} onChange={() => {}} />);

    const rectangle = await screen.findByRole('button', { name: 'Rectangle' });
    await user.click(rectangle);
    expect(engine.setTool).toHaveBeenLastCalledWith('rectangle');
    expect(rectangle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/Click one corner/)).toBeInTheDocument();

    await user.click(rectangle);
    expect(engine.setTool).toHaveBeenLastCalledWith('select');
    expect(rectangle).toHaveAttribute('aria-pressed', 'false');
  });

  it('reports a drawn area upward and does not redraw it on the map', async () => {
    const onChange = vi.fn();
    const { engine, handlers } = fakeEngine();
    const { rerender } = render(<AreaMap geometry={null} onChange={onChange} />);
    await screen.findByRole('toolbar');

    handlers().onAreaChange(square);
    expect(onChange).toHaveBeenCalledWith(square);

    // The parent stores the geometry and passes it back; the map already shows it.
    rerender(<AreaMap geometry={square} onChange={onChange} />);
    expect(engine.showArea).not.toHaveBeenCalled();
    expect(screen.getByText('61°E to 71°E, 51°N to 55°N')).toBeInTheDocument();
  });

  it('shows an area chosen outside the map and moves the view to it', async () => {
    const { engine } = fakeEngine();
    const { rerender } = render(<AreaMap geometry={null} onChange={() => {}} />);
    await screen.findByRole('toolbar');

    rerender(<AreaMap geometry={square} onChange={() => {}} />);
    await waitFor(() => expect(engine.showArea).toHaveBeenCalledWith(square, { fit: true }));
  });

  it('clears the area', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { engine } = fakeEngine();
    render(<AreaMap geometry={square} onChange={onChange} />);

    await user.click(await screen.findByRole('button', { name: 'Clear' }));
    expect(engine.showArea).toHaveBeenLastCalledWith(null, { fit: false });
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('toggles the satellite imagery', async () => {
    const user = userEvent.setup();
    const { engine } = fakeEngine();
    render(<AreaMap geometry={null} onChange={() => {}} />);

    const satellite = await screen.findByRole('button', { name: 'Satellite' });
    await user.click(satellite);
    expect(engine.setSatellite).toHaveBeenLastCalledWith(true);
    expect(satellite).toHaveAttribute('aria-pressed', 'true');
  });

  it('falls back to a plain grid when the map cannot start', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    engineMock.create.mockRejectedValue(new Error('WebGL is not available'));
    render(<AreaMap geometry={square} onChange={() => {}} />);

    expect(
      await screen.findByRole('img', { name: 'Selected area: 61°E to 71°E, 51°N to 55°N' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/The interactive map could not load/)).toBeInTheDocument();
  });

  it('removes the map when the component goes away', async () => {
    const { engine } = fakeEngine();
    const { unmount } = render(<AreaMap geometry={null} onChange={() => {}} />);
    await screen.findByRole('toolbar');

    unmount();
    expect(engine.destroy).toHaveBeenCalled();
  });
});
