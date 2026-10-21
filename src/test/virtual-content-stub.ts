/**
 * Test-only stand-in for the build-time `virtual:content` module. It serves the
 * real page content files so tests see the same labels as the app. Add a named
 * export here when a page under test needs one.
 */
import customersContent from '../content/pages/customers.json';
import customerProfileContent from '../content/pages/customer_profile.json';
import dashboardContent from '../content/pages/dashboard.json';
import schedulingContent from '../content/pages/scheduling.json';

export const customers = customersContent;
export const customer_profile = customerProfileContent;
export const dashboard = dashboardContent;
export const scheduling = schedulingContent;
import financeContent from '../content/pages/finance.json';
export const finance = financeContent;
