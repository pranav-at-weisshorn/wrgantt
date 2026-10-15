import { describe, expect, it } from 'vitest';
import { rollUpStatus, scheduleHealth, statusOf } from './status';

describe('status', () => {
  it('derives the effective status from progress and the user-set value', () => {
    expect(statusOf({ percentComplete: 0 })).toBe('notStarted');
    expect(statusOf({ percentComplete: 30 })).toBe('inProgress');
    expect(statusOf({ percentComplete: 0, actualStart: '2027-01-04' })).toBe('inProgress');
    expect(statusOf({ percentComplete: 100 })).toBe('complete');
    expect(statusOf({ percentComplete: 40, status: 'blocked' })).toBe('blocked');
    expect(statusOf({ percentComplete: 100, status: 'onHold' })).toBe('complete');
    expect(statusOf({ percentComplete: 0, status: 'inProgress' })).toBe('inProgress');
  });
  it('rolls up', () => {
    expect(rollUpStatus(['complete', 'complete'])).toBe('complete');
    expect(rollUpStatus(['complete', 'notStarted'])).toBe('inProgress');
    expect(rollUpStatus(['notStarted', 'blocked'])).toBe('blocked');
    expect(rollUpStatus(['notStarted', 'onHold'])).toBe('onHold');
    expect(rollUpStatus(['notStarted'])).toBe('notStarted');
  });
  it('gives a management signal', () => {
    const calc = { totalFloat: 3, critical: false };
    expect(scheduleHealth('complete', calc, 5)).toBe('complete');
    expect(scheduleHealth('notStarted', calc, null)).toBe('onTrack');
    expect(scheduleHealth('notStarted', calc, 2)).toBe('atRisk');
    expect(scheduleHealth('blocked', calc, null)).toBe('atRisk');
    expect(scheduleHealth('inProgress', { totalFloat: 0, critical: true }, 1)).toBe('late');
    expect(scheduleHealth('inProgress', { totalFloat: -2, critical: true }, null)).toBe('late');
  });
});
