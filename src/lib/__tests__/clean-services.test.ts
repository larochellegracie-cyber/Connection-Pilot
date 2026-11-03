import { describe, expect, it } from 'vitest';
import { cleanServiceList, isServiceName, splitServiceText } from '../clean-services';

describe('keeping only real service names', () => {
  it('drops the scraped FAQ text Somerset actually has, leaving an empty list (services unknown)', () => {
    expect(cleanServiceList(['you service Windsor and surrounding areas? Question How far in advance should I book? Question What is the best way to book a service'])).toEqual([]);
  });
  it('keeps a clean list as it is', () => {
    expect(cleanServiceList(['Pool opening', 'Pool closing', 'Weekly cleaning', 'Salt system service'])).toEqual(['Pool opening', 'Pool closing', 'Weekly cleaning', 'Salt system service']);
  });
  it('pulls the real names out of a comma, semicolon or line separated lump', () => {
    expect(cleanServiceList(['Pool opening, Pool closing; Weekly cleaning\nLiner repair'])).toEqual(['Pool opening', 'Pool closing', 'Weekly cleaning', 'Liner repair']);
    expect(cleanServiceList(['• Pool opening • Pool closing'])).toEqual(['Pool opening', 'Pool closing']);
  });
  it('keeps the real names and drops the FAQ in a mixed lump', () => {
    expect(cleanServiceList(['Pool opening, Question How do I book? Question Do you offer weekly service? Pool closing'])).toEqual(['Pool opening', 'Pool closing']);
  });
  it.each(['How far in advance should I book?', 'What is the best way to book a service', 'you service Windsor and surrounding areas', 'We offer the best pool service in town', 'Call us at (519) 982-4901', 'Click here to learn more', 'https://somersetpoolservice.com/book', 'info@somerset.com', 'Frequently asked questions', 'Privacy policy', 'A very long description of everything that this company does for its many customers', '', '12', 'Do you open pools?'])('is not a service name: %s', (text) => { expect(isServiceName(text)).toBe(false); });
  it.each(['Pool opening', 'Pool closing', 'Chocolate birthday cakes', 'Water testing', 'Liner repair', 'Salt system service', 'Custom wedding cakes', 'Deep clean'])('is a service name: %s', (text) => { expect(isServiceName(text)).toBe(true); });
  it('removes repeats regardless of case, and limits the list', () => {
    expect(cleanServiceList(['Pool opening', 'pool opening', 'POOL OPENING', 'Pool closing'])).toEqual(['Pool opening', 'Pool closing']);
    expect(cleanServiceList(Array.from({ length: 40 }, (_, i) => `Service ${String.fromCharCode(65 + (i % 26))}${i}`), 5)).toHaveLength(5);
  });
  it('splits loose text into pieces', () => { expect(splitServiceText('a, b; c\nd Question e?')).toEqual(['a', 'b', 'c', 'd', 'e']); });
});
