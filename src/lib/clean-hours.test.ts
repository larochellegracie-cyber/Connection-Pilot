import { describe, expect, it } from 'vitest';
import { cleanHours } from './clean-hours';

describe('cleanHours', () => {
  it('writes day and time ranges tidily, one per line', () => {
    expect(cleanHours('Mon-Fri 8am-5pm')).toBe('Mon–Fri: 8:00 AM – 5:00 PM');
    expect(cleanHours('Monday - Friday: 9:00 AM - 5:30 PM, Saturday 10am to 2pm, Sunday closed')).toBe('Mon–Fri: 9:00 AM – 5:30 PM\nSat: 10:00 AM – 2:00 PM\nSun: Closed');
    expect(cleanHours('Closed Sundays')).toBe('Sun: Closed');
  });

  it('pulls the hours out of a lump of page text and drops the rest', () => {
    const raw = 'Contact us Hours of operation Monday to Friday 9:00 AM to 5:00 PM Weekends by appointment. How far in advance should I book? We service Windsor and surrounding areas. Call (519) 982-4901 or email us.';
    expect(cleanHours(raw)).toBe('Mon–Fri: 9:00 AM – 5:00 PM');
  });

  it('keeps a short plain line, and leaves the field blank when the text has no hours in it', () => {
    expect(cleanHours('By appointment')).toBe('By appointment');
    expect(cleanHours('Open 24 hours')).toBe('Open 24 hours');
    expect(cleanHours('Pool opening and closing, weekly maintenance, power washing. How far in advance should I book? Our team will respond within 24 hours to every enquiry.')).toBe('');
    expect(cleanHours('')).toBe(''); expect(cleanHours(null)).toBe('');
  });
});
