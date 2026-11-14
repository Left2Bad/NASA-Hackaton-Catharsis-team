import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/errors';
import { ErrorNote } from './ErrorNote';
import { LoadingNote, SLOW_AFTER_MS } from './LoadingNote';

describe('ErrorNote', () => {
  it.each([
    ['NETWORK', 'The server cannot be reached. Check the connection and try again.'],
    [
      'TIMEOUT',
      'The server is taking too long to answer. Try again, or choose a smaller area or a shorter period.',
    ],
    ['UNKNOWN', 'The server answered in an unexpected way. Try again in a moment.'],
  ] as const)('explains %s in the words of the app', (code, text) => {
    render(<ErrorNote error={new ApiError(code, 'technical detail', 0)} />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('data-code', code);
    expect(alert).toHaveTextContent(text);
    expect(alert).not.toHaveTextContent('technical detail');
  });

  it('treats an error that is not an ApiError as a network failure', () => {
    render(<ErrorNote error={new TypeError('Failed to fetch')} />);

    expect(screen.getByRole('alert')).toHaveAttribute('data-code', 'NETWORK');
  });

  it('offers to try again when that can help', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<ErrorNote error={new ApiError('INTERNAL', '', 500)} onRetry={onRetry} />);

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('has no retry button for a request the server refused', () => {
    render(<ErrorNote error={new ApiError('AREA_TOO_LARGE', '', 413)} onRetry={() => {}} />);

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('has no retry button when there is nothing to call', () => {
    render(<ErrorNote error={new ApiError('NETWORK', '', 0)} />);

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('holds the button while a retry is under way', () => {
    render(<ErrorNote error={new ApiError('NETWORK', '', 0)} onRetry={() => {}} retrying />);

    expect(screen.getByRole('button', { name: 'Trying…' })).toBeDisabled();
  });
});

describe('LoadingNote', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('adds the hint only when the wait gets long', () => {
    vi.useFakeTimers();
    render(<LoadingNote slowHint="Still working.">Loading the calendar…</LoadingNote>);

    const note = screen.getByRole('status');
    expect(note).toHaveTextContent('Loading the calendar…');
    expect(note).not.toHaveTextContent('Still working.');

    act(() => {
      vi.advanceTimersByTime(SLOW_AFTER_MS);
    });
    expect(note).toHaveTextContent('Loading the calendar… Still working.');
  });

  it('never changes without a hint', () => {
    vi.useFakeTimers();
    render(<LoadingNote>Loading the current month…</LoadingNote>);

    act(() => {
      vi.advanceTimersByTime(SLOW_AFTER_MS * 2);
    });
    expect(screen.getByRole('status')).toHaveTextContent(/^Loading the current month…$/);
  });
});
