import type { ImportKind } from './types.js';

export type FieldDef = { key: string; label: string; /** Normalised header names that mean this field. An entry ending in * also matches headers that contain it. */ synonyms: string[] };

const customerRef: FieldDef[] = [
  { key: 'customerName', label: 'Customer name', synonyms: ['customer', 'customername', 'client', 'clientname', 'billto', 'billedto', 'name', 'company'] },
  { key: 'customerEmail', label: 'Customer email', synonyms: ['customeremail', 'clientemail', 'email', 'emailaddress'] },
  { key: 'customerPhone', label: 'Customer phone', synonyms: ['customerphone', 'clientphone', 'phone', 'phonenumber', 'mobile', 'cell'] },
];

export const fieldsByKind: Record<ImportKind, FieldDef[]> = {
  customers: [
    { key: 'firstName', label: 'First name', synonyms: ['firstname', 'first', 'givenname'] },
    { key: 'lastName', label: 'Last name', synonyms: ['lastname', 'last', 'surname', 'familyname'] },
    { key: 'name', label: 'Name', synonyms: ['name', 'fullname', 'customer', 'customername', 'client', 'clientname', 'contact', 'contactname'] },
    { key: 'phone', label: 'Phone', synonyms: ['phone', 'phonenumber', 'mobile', 'mobilephone', 'cell', 'cellphone', 'telephone', 'tel', 'primaryphone'] },
    { key: 'email', label: 'Email', synonyms: ['email', 'emailaddress', 'e-mail', 'primaryemail'] },
    { key: 'address', label: 'Address', synonyms: ['address', 'streetaddress', 'street', 'serviceaddress', 'billingaddress', 'location'] },
    { key: 'company', label: 'Company', synonyms: ['company', 'companyname', 'business', 'businessname', 'organization'] },
  ],
  employees: [
    { key: 'firstName', label: 'First name', synonyms: ['firstname', 'first', 'givenname'] },
    { key: 'lastName', label: 'Last name', synonyms: ['lastname', 'last', 'surname', 'familyname'] },
    { key: 'name', label: 'Name', synonyms: ['name', 'fullname', 'employee', 'employeename', 'staff', 'staffmember', 'teammember'] },
    { key: 'role', label: 'Role', synonyms: ['role', 'position', 'title', 'jobtitle', 'department'] },
    { key: 'email', label: 'Email', synonyms: ['email', 'emailaddress', 'workemail'] },
    { key: 'phone', label: 'Phone', synonyms: ['phone', 'phonenumber', 'mobile', 'cell', 'telephone'] },
    { key: 'status', label: 'Status', synonyms: ['status', 'active', 'employmentstatus'] },
  ],
  services: [
    { key: 'name', label: 'Service or product', synonyms: ['service', 'servicename', 'product', 'productname', 'item', 'itemname', 'name', 'description'] },
    { key: 'price', label: 'Price', synonyms: ['price', 'rate', 'cost', 'amount', 'unitprice', 'fee', 'charge', 'retailprice'] },
    { key: 'unit', label: 'Per (unit)', synonyms: ['unit', 'per', 'uom', 'unitofmeasure', 'pricingunit'] },
    { key: 'details', label: 'Details', synonyms: ['details', 'notes', 'category', 'type'] },
  ],
  jobs: [
    ...customerRef,
    { key: 'service', label: 'Service / job', synonyms: ['service', 'job', 'jobname', 'jobtype', 'jobdescription', 'worktype', 'task', 'title', 'description', 'servicetype'] },
    { key: 'address', label: 'Address', synonyms: ['address', 'jobaddress', 'serviceaddress', 'location', 'site'] },
    { key: 'employee', label: 'Assigned employee', synonyms: ['employee', 'assignedto', 'assigned', 'assignedemployee', 'technician', 'tech', 'staff', 'crew'] },
    { key: 'date', label: 'Date', synonyms: ['date', 'scheduled', 'scheduleddate', 'scheduledat', 'jobdate', 'servicedate', 'start', 'startdate', 'when'] },
    { key: 'duration', label: 'Duration (minutes)', synonyms: ['duration', 'durationminutes', 'minutes', 'length'] },
    { key: 'status', label: 'Status', synonyms: ['status', 'jobstatus', 'state'] },
  ],
  quotes: [
    { key: 'number', label: 'Quote number', synonyms: ['quote', 'quotenumber', 'quoteno', 'quoteid', 'estimate', 'estimatenumber', 'estimateno', 'estimateid', 'number', 'no', 'id', 'reference', 'ref'] },
    ...customerRef,
    { key: 'date', label: 'Date', synonyms: ['date', 'quotedate', 'estimatedate', 'issued', 'issuedate', 'created', 'createddate'] },
    { key: 'expires', label: 'Expiry date', synonyms: ['expires', 'expiry', 'expirydate', 'validuntil', 'expiration', 'expirationdate'] },
    { key: 'subtotal', label: 'Subtotal', synonyms: ['subtotal', 'netamount', 'net'] },
    { key: 'tax', label: 'Tax', synonyms: ['tax', 'taxes', 'taxamount', 'gst', 'hst', 'vat', 'salestax'] },
    { key: 'total', label: 'Total', synonyms: ['total', 'amount', 'totalamount', 'grandtotal', 'quotetotal', 'estimatetotal', 'price'] },
    { key: 'status', label: 'Status', synonyms: ['status', 'state'] },
    { key: 'description', label: 'Description', synonyms: ['description', 'service', 'item', 'items', 'summary', 'details', 'work'] },
  ],
  invoices: [
    { key: 'number', label: 'Invoice number', synonyms: ['invoice', 'invoicenumber', 'invoiceno', 'invoiceid', 'inv', 'invno', 'number', 'no', 'id', 'reference', 'ref'] },
    ...customerRef,
    { key: 'date', label: 'Date', synonyms: ['date', 'invoicedate', 'issued', 'issuedate', 'created', 'createddate'] },
    { key: 'due', label: 'Due date', synonyms: ['due', 'duedate', 'paymentdue', 'payby'] },
    { key: 'subtotal', label: 'Subtotal', synonyms: ['subtotal', 'netamount', 'net'] },
    { key: 'tax', label: 'Tax', synonyms: ['tax', 'taxes', 'taxamount', 'gst', 'hst', 'vat', 'salestax'] },
    { key: 'total', label: 'Total', synonyms: ['total', 'amount', 'totalamount', 'grandtotal', 'invoicetotal', 'balance', 'amountdue'] },
    { key: 'status', label: 'Status', synonyms: ['status', 'paymentstatus', 'state'] },
    { key: 'description', label: 'Description', synonyms: ['description', 'service', 'item', 'items', 'summary', 'details', 'work'] },
  ],
};

/** Extra choices offered for any column, for any kind. */
export const extraChoices = [{ key: 'notes', label: 'Add to notes' }, { key: 'ignore', label: 'Ignore this column' }];

export function fieldLabel(kind: ImportKind, key: string): string {
  if (key === 'notes') return 'Notes';
  if (key === 'ignore') return 'Ignored';
  return fieldsByKind[kind].find((field) => field.key === key)?.label ?? key;
}
