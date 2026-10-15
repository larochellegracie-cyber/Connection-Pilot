import { boolean, decimal, int, mysqlTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';

export const user = mysqlTable('user', {
  id: varchar('id', { length: 36 }).primaryKey(),
  name: varchar('name', { length: 255 }),
  email: varchar('email', { length: 255 }).notNull().unique(),
  emailVerified: boolean('email_verified').default(false),
  image: text('image'),
  isAdmin: boolean('is_admin').default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
});

export const session = mysqlTable('session', {
  id: varchar('id', { length: 36 }).primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: varchar('token', { length: 255 }).notNull().unique(),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),
  userId: varchar('user_id', { length: 36 }).notNull().references(() => user.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
});

export const account = mysqlTable('account', {
  id: varchar('id', { length: 36 }).primaryKey(),
  accountId: varchar('account_id', { length: 255 }).notNull(),
  providerId: varchar('provider_id', { length: 255 }).notNull(),
  userId: varchar('user_id', { length: 36 }).notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: varchar('password', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
});

export const verification = mysqlTable('verification', {
  id: varchar('id', { length: 36 }).primaryKey(),
  identifier: varchar('identifier', { length: 255 }).notNull(),
  value: varchar('value', { length: 255 }).notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
});

export const businessProfile = mysqlTable('business_profile', {
  id: varchar('id', { length: 36 }).primaryKey(),
  userId: varchar('user_id', { length: 36 }).notNull().unique().references(() => user.id, { onDelete: 'cascade' }),
  businessName: varchar('business_name', { length: 255 }).notNull(),
  businessType: varchar('business_type', { length: 100 }).notNull(),
  phoneNumber: varchar('phone_number', { length: 40 }).unique(),
  businessEmail: varchar('business_email', { length: 255 }),
  address: varchar('address', { length: 255 }).notNull(),
  city: varchar('city', { length: 120 }).notNull(),
  region: varchar('region', { length: 120 }).notNull(),
  postalCode: varchar('postal_code', { length: 24 }).notNull(),
  website: varchar('website', { length: 255 }),
  communicationNeeds: text('communication_needs').notNull(),
  customerChannels: text('customer_channels').notNull(),
  monthlyInquiryVolume: varchar('monthly_inquiry_volume', { length: 40 }).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
});

export const businessKnowledge = mysqlTable('business_knowledge', {
  id: varchar('id', { length: 36 }).primaryKey(),
  businessProfileId: varchar('business_profile_id', { length: 36 }).notNull().unique().references(() => businessProfile.id, { onDelete: 'cascade' }),
  serviceArea: text('service_area').notNull(),
  businessHours: text('business_hours').notNull(),
  servicesOffered: text('services_offered').notNull(),
  pricingInformation: text('pricing_information').notNull(),
  frequentlyAskedQuestions: text('frequently_asked_questions').notNull(),
  policies: text('policies').notNull(),
  receptionistInstructions: text('receptionist_instructions').notNull(),
  discloseAutomation: boolean('disclose_automation').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
});

export const businessKnowledgeSource = mysqlTable('business_knowledge_source', {
  id: varchar('id', { length: 36 }).primaryKey(),
  businessProfileId: varchar('business_profile_id', { length: 36 }).notNull().references(() => businessProfile.id, { onDelete: 'cascade' }),
  sourceUrl: varchar('source_url', { length: 2048 }).notNull(),
  content: text('content').notNull(),
  importedAt: timestamp('imported_at').defaultNow().notNull(),
});

export const pilotKnowledgeFact = mysqlTable('pilot_knowledge_fact', {
  id: varchar('id', { length: 36 }).primaryKey(),
  businessProfileId: varchar('business_profile_id', { length: 36 }).notNull().references(() => businessProfile.id, { onDelete: 'cascade' }),
  kind: varchar('kind', { length: 50 }).notNull(),
  subject: varchar('subject', { length: 255 }).notNull(),
  predicate: varchar('predicate', { length: 100 }).notNull(),
  value: text('value').notNull(),
  unit: varchar('unit', { length: 120 }),
  details: text('details'),
  normalizedKey: varchar('normalized_key', { length: 500 }).notNull(),
  sourceType: varchar('source_type', { length: 50 }).notNull(),
  sourceReference: text('source_reference'),
  confidence: varchar('confidence', { length: 30 }).notNull().default('explicit'),
  status: varchar('status', { length: 30 }).notNull().default('accepted'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
}, (table) => ({
  factUnique: uniqueIndex('pilot_knowledge_fact_unique').on(table.businessProfileId, table.normalizedKey),
}));

export const marketingProfile = mysqlTable('marketing_profile', {
  id: varchar('id', { length: 36 }).primaryKey(),
  businessProfileId: varchar('business_profile_id', { length: 36 }).notNull().unique().references(() => businessProfile.id, { onDelete: 'cascade' }),
  // Source
  websiteUrl: varchar('website_url', { length: 2048 }),
  analysisStatus: varchar('analysis_status', { length: 30 }).notNull().default('pending'), // pending | complete | failed
  analyzedAt: timestamp('analyzed_at'),
  approvalStatus: varchar('approval_status', { length: 30 }).notNull().default('review_required'), // review_required | confirmed
  confirmedAt: timestamp('confirmed_at'),
  // Business overview
  businessName: varchar('business_name', { length: 255 }),
  businessDescription: text('business_description'),
  location: varchar('location', { length: 512 }),
  contactPhone: varchar('contact_phone', { length: 80 }),
  contactEmail: varchar('contact_email', { length: 255 }),
  businessHours: text('business_hours'),
  // Services & products
  services: text('services'),        // JSON array of strings
  products: text('products'),        // JSON array of strings
  pricing: text('pricing'),          // free-text summary
  // Customers
  targetCustomers: text('target_customers'),
  customerNeeds: text('customer_needs'),
  // Brand
  brandTone: varchar('brand_tone', { length: 255 }),
  brandDescription: text('brand_description'),
  brandColors: varchar('brand_colors', { length: 255 }),
  logoUrl: varchar('logo_url', { length: 2048 }),
  // Marketing
  promotions: text('promotions'),
  keySellingPoints: text('key_selling_points'), // JSON array of strings
  frequentlyAskedQuestions: text('frequently_asked_questions'),
  importantNotes: text('important_notes'),
  socialLinks: text('social_links'),            // JSON object
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
});

export const marketingContentPlan = mysqlTable('marketing_content_plan', {
  id: varchar('id', { length: 36 }).primaryKey(),
  businessProfileId: varchar('business_profile_id', { length: 36 }).notNull().references(() => businessProfile.id, { onDelete: 'cascade' }),
  marketingProfileId: varchar('marketing_profile_id', { length: 36 }).notNull().references(() => marketingProfile.id, { onDelete: 'cascade' }),
  status: varchar('status', { length: 30 }).notNull().default('active'),
  planJson: text('plan_json').notNull(),
  recommendationsJson: text('recommendations_json').notNull(),
  generatedAt: timestamp('generated_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
});

export const marketingGeneratedPost = mysqlTable('marketing_generated_post', {
  id: varchar('id', { length: 36 }).primaryKey(),
  businessProfileId: varchar('business_profile_id', { length: 36 }).notNull().references(() => businessProfile.id, { onDelete: 'cascade' }),
  marketingContentPlanId: varchar('marketing_content_plan_id', { length: 36 }).references(() => marketingContentPlan.id, { onDelete: 'set null' }),
  planItemId: varchar('plan_item_id', { length: 80 }),
  hook: text('hook').notNull(),
  caption: text('caption').notNull(),
  callToAction: text('call_to_action').notNull(),
  suggestedVisual: text('suggested_visual').notNull(),
  platform: varchar('platform', { length: 100 }).notNull(),
  hashtagsJson: text('hashtags_json').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
});

export const pilotKnowledgeDocument = mysqlTable('pilot_knowledge_document', {
  id: varchar('id', { length: 36 }).primaryKey(),
  businessProfileId: varchar('business_profile_id', { length: 36 }).notNull().references(() => businessProfile.id, { onDelete: 'cascade' }),
  fileName: varchar('file_name', { length: 255 }).notNull(),
  fileType: varchar('file_type', { length: 80 }).notNull(),
  sourceReference: text('source_reference'),
  storagePath: varchar('storage_path', { length: 1024 }),
  originalSizeBytes: int('original_size_bytes'),
  extractedText: text('extracted_text').notNull(),
  status: varchar('status', { length: 30 }).notNull().default('review_required'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  reviewedAt: timestamp('reviewed_at'),
});

export const pilotKnowledgeDocumentFact = mysqlTable('pilot_knowledge_document_fact', {
  id: varchar('id', { length: 36 }).primaryKey(),
  documentId: varchar('document_id', { length: 36 }).notNull().references(() => pilotKnowledgeDocument.id, { onDelete: 'cascade' }),
  businessProfileId: varchar('business_profile_id', { length: 36 }).notNull().references(() => businessProfile.id, { onDelete: 'cascade' }),
  groupName: varchar('group_name', { length: 80 }).notNull(),
  kind: varchar('kind', { length: 50 }).notNull(),
  subject: varchar('subject', { length: 255 }).notNull(),
  predicate: varchar('predicate', { length: 100 }).notNull(),
  value: text('value').notNull(),
  unit: varchar('unit', { length: 120 }),
  details: text('details'),
  evidence: text('evidence').notNull(),
  normalizedKey: varchar('normalized_key', { length: 500 }).notNull(),
  confidence: varchar('confidence', { length: 30 }).notNull(),
  status: varchar('status', { length: 30 }).notNull().default('pending_review'),
  matchingFactId: varchar('matching_fact_id', { length: 36 }).references(() => pilotKnowledgeFact.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  reviewedAt: timestamp('reviewed_at'),
}, (table) => ({
  documentFactUnique: uniqueIndex('pilot_document_fact_unique').on(table.documentId, table.normalizedKey),
}));

export const phoneConnection = mysqlTable('phone_connection', {
  id: varchar('id', { length: 36 }).primaryKey(),
  businessProfileId: varchar('business_profile_id', { length: 36 }).notNull().unique().references(() => businessProfile.id, { onDelete: 'cascade' }),
  requestedNumber: varchar('requested_number', { length: 40 }).unique(),
  connectedNumber: varchar('connected_number', { length: 40 }).unique(),
  method: varchar('method', { length: 30 }).notNull().default('port'),
  status: varchar('status', { length: 40 }).notNull().default('not_connected'),
  carrierName: varchar('carrier_name', { length: 255 }),
  accountNumber: varchar('account_number', { length: 255 }),
  billingTelephoneNumber: varchar('billing_telephone_number', { length: 40 }),
  accountHolderName: varchar('account_holder_name', { length: 255 }),
  serviceAddress: text('service_address'),
  authorizedContactName: varchar('authorized_contact_name', { length: 255 }),
  authorizedContactEmail: varchar('authorized_contact_email', { length: 255 }),
  portingNotes: text('porting_notes'),
  requestedCountry: varchar('requested_country', { length: 2 }),
  requestedAreaCode: varchar('requested_area_code', { length: 12 }),
  customerConfirmedAt: timestamp('customer_confirmed_at'),
  twilioPhoneSid: varchar('twilio_phone_sid', { length: 64 }),
  lastError: text('last_error'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
});



export const businessConnection = mysqlTable('business_connection', {
  id: varchar('id', { length: 36 }).primaryKey(),
  businessProfileId: varchar('business_profile_id', { length: 36 }).notNull().references(() => businessProfile.id, { onDelete: 'cascade' }),
  provider: varchar('provider', { length: 50 }).notNull(),
  status: varchar('status', { length: 30 }).notNull().default('not_connected'),
  connectedAt: timestamp('connected_at'),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
}, (table) => ({
  businessProviderUnique: uniqueIndex('business_connection_provider_unique').on(table.businessProfileId, table.provider),
}));
export const customer = mysqlTable('customer', {
  id: varchar('id', { length: 36 }).primaryKey(),
  businessProfileId: varchar('business_profile_id', { length: 36 }).notNull().references(() => businessProfile.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  phoneNumber: varchar('phone_number', { length: 40 }).notNull(),
  email: varchar('email', { length: 255 }),
  address: text('address'),
  company: varchar('company', { length: 255 }),
  status: varchar('status', { length: 30 }).notNull().default('new'),
  archivedAt: timestamp('archived_at'),
  firstContactedAt: timestamp('first_contacted_at').defaultNow().notNull(),
  lastContactedAt: timestamp('last_contacted_at').defaultNow().notNull(),
  callCount: int('call_count').default(0).notNull(),
  messageCount: int('message_count').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
}, (table) => ({
  businessPhoneUnique: uniqueIndex('customer_business_phone_unique').on(table.businessProfileId, table.phoneNumber),
}));

export const customerConversation = mysqlTable('customer_conversation', {
  id: varchar('id', { length: 36 }).primaryKey(),
  customerId: varchar('customer_id', { length: 36 }).notNull().references(() => customer.id, { onDelete: 'cascade' }),
  channel: varchar('channel', { length: 30 }).notNull(),
  direction: varchar('direction', { length: 20 }).notNull(),
  content: text('content').notNull(),
  externalId: varchar('external_id', { length: 255 }),
  occurredAt: timestamp('occurred_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});


export const customerInteraction = mysqlTable('customer_interaction', {
  id: varchar('id', { length: 36 }).primaryKey(),
  customerId: varchar('customer_id', { length: 36 }).notNull().references(() => customer.id, { onDelete: 'cascade' }),
  interactionType: varchar('interaction_type', { length: 30 }).notNull(),
  phoneNumber: varchar('phone_number', { length: 40 }).notNull(),
  direction: varchar('direction', { length: 20 }).notNull().default('inbound'),
  status: varchar('status', { length: 60 }),
  conversation: text('conversation'),
  summary: text('summary'),
  outcome: varchar('outcome', { length: 120 }),
  followUpNeeded: boolean('follow_up_needed').notNull().default(false),
  recordingUrl: text('recording_url'),
  transcript: text('transcript'),
  externalId: varchar('external_id', { length: 255 }).notNull().unique(),
  occurredAt: timestamp('occurred_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
});
export const customerAppointment = mysqlTable('customer_appointment', {
  id: varchar('id', { length: 36 }).primaryKey(),
  customerId: varchar('customer_id', { length: 36 }).notNull().references(() => customer.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 255 }).notNull(),
  status: varchar('status', { length: 40 }).notNull().default('scheduled'),
  scheduledAt: timestamp('scheduled_at').notNull(),
  durationMinutes: int('duration_minutes').notNull().default(60),
  notes: text('notes'),
  sourceExternalId: varchar('source_external_id', { length: 255 }).unique(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
});

export const calendarSettings = mysqlTable('calendar_settings', {
  id: varchar('id', { length: 36 }).primaryKey(),
  businessProfileId: varchar('business_profile_id', { length: 36 }).notNull().unique().references(() => businessProfile.id, { onDelete: 'cascade' }),
  timezone: varchar('timezone', { length: 80 }).notNull().default('America/Toronto'),
  weeklyHours: text('weekly_hours').notNull(),
  defaultDurationMinutes: int('default_duration_minutes').notNull().default(60),
  bufferMinutes: int('buffer_minutes').notNull().default(0),
  allowOverlaps: boolean('allow_overlaps').notNull().default(false),
  maxConcurrentAppointments: int('max_concurrent_appointments').notNull().default(1),
  minimumNoticeMinutes: int('minimum_notice_minutes').notNull().default(0),
  bookingWindowDays: int('booking_window_days').notNull().default(90),
  allowSameDay: boolean('allow_same_day').notNull().default(true),
  reschedulingPolicy: varchar('rescheduling_policy', { length: 20 }).notNull().default('anytime'),
  reschedulingNoticeHours: int('rescheduling_notice_hours').notNull().default(0),
  cancellationPolicy: varchar('cancellation_policy', { length: 20 }).notNull().default('anytime'),
  cancellationNoticeHours: int('cancellation_notice_hours').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
});

export const customerNote = mysqlTable('customer_note', {
  id: varchar('id', { length: 36 }).primaryKey(),
  customerId: varchar('customer_id', { length: 36 }).notNull().references(() => customer.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
});

export const customerTag = mysqlTable('customer_tag', {
  id: varchar('id', { length: 36 }).primaryKey(),
  customerId: varchar('customer_id', { length: 36 }).notNull().references(() => customer.id, { onDelete: 'cascade' }),
  label: varchar('label', { length: 80 }).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const customerActivity = mysqlTable('customer_activity', {
  id: varchar('id', { length: 36 }).primaryKey(),
  customerId: varchar('customer_id', { length: 36 }).notNull().references(() => customer.id, { onDelete: 'cascade' }),
  activityType: varchar('activity_type', { length: 50 }).notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  detail: text('detail'),
  occurredAt: timestamp('occurred_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});


export const businessNotification = mysqlTable('business_notification', {
  id: varchar('id', { length: 36 }).primaryKey(),
  businessProfileId: varchar('business_profile_id', { length: 36 }).notNull().references(() => businessProfile.id, { onDelete: 'cascade' }),
  customerId: varchar('customer_id', { length: 36 }).notNull().references(() => customer.id, { onDelete: 'cascade' }),
  appointmentId: varchar('appointment_id', { length: 36 }).references(() => customerAppointment.id, { onDelete: 'set null' }),
  type: varchar('type', { length: 40 }).notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  detail: text('detail').notNull(),
  beforeDetails: text('before_details'),
  afterDetails: text('after_details'),
  readAt: timestamp('read_at'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const lead = mysqlTable('lead', {
  id: varchar('id', { length: 36 }).primaryKey(),
  businessProfileId: varchar('business_profile_id', { length: 36 }).notNull().references(() => businessProfile.id, { onDelete: 'cascade' }),
  customerId: varchar('customer_id', { length: 36 }).references(() => customer.id, { onDelete: 'set null' }),
  name: varchar('name', { length: 255 }).notNull(),
  phoneNumber: varchar('phone_number', { length: 40 }),
  email: varchar('email', { length: 255 }),
  address: text('address'),
  serviceRequested: varchar('service_requested', { length: 255 }).notNull(),
  source: varchar('source', { length: 120 }),
  estimatedValue: decimal('estimated_value', { precision: 12, scale: 2 }),
  status: varchar('status', { length: 30 }).notNull().default('new'),
  assignedEmployee: varchar('assigned_employee', { length: 255 }),
  lastContactedAt: timestamp('last_contacted_at'),
  wonAt: timestamp('won_at'),
  lostAt: timestamp('lost_at'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
});

export const leadActivity = mysqlTable('lead_activity', {
  id: varchar('id', { length: 36 }).primaryKey(),
  leadId: varchar('lead_id', { length: 36 }).notNull().references(() => lead.id, { onDelete: 'cascade' }),
  activityType: varchar('activity_type', { length: 50 }).notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  detail: text('detail'),
  occurredAt: timestamp('occurred_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const job = mysqlTable('job', {
  id: varchar('id', { length: 36 }).primaryKey(),
  businessProfileId: varchar('business_profile_id', { length: 36 }).notNull().references(() => businessProfile.id, { onDelete: 'cascade' }),
  customerId: varchar('customer_id', { length: 36 }).notNull().references(() => customer.id, { onDelete: 'cascade' }),
  appointmentId: varchar('appointment_id', { length: 36 }).references(() => customerAppointment.id, { onDelete: 'set null' }),
  leadId: varchar('lead_id', { length: 36 }).references(() => lead.id, { onDelete: 'set null' }),
  service: varchar('service', { length: 255 }).notNull(),
  address: text('address'),
  assignedEmployee: varchar('assigned_employee', { length: 255 }),
  scheduledAt: timestamp('scheduled_at'),
  durationMinutes: int('duration_minutes'),
  status: varchar('status', { length: 30 }).notNull().default('booked'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
});

export const jobActivity = mysqlTable('job_activity', {
  id: varchar('id', { length: 36 }).primaryKey(),
  jobId: varchar('job_id', { length: 36 }).notNull().references(() => job.id, { onDelete: 'cascade' }),
  activityType: varchar('activity_type', { length: 50 }).notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  detail: text('detail'),
  occurredAt: timestamp('occurred_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const jobFile = mysqlTable('job_file', {
  id: varchar('id', { length: 36 }).primaryKey(),
  jobId: varchar('job_id', { length: 36 }).notNull().references(() => job.id, { onDelete: 'cascade' }),
  fileName: varchar('file_name', { length: 255 }).notNull(),
  fileUrl: text('file_url').notNull(),
  fileType: varchar('file_type', { length: 120 }),
  createdAt: timestamp('created_at').defaultNow(),
});

export const estimate = mysqlTable('estimate', {
  id: varchar('id', { length: 36 }).primaryKey(),
  businessProfileId: varchar('business_profile_id', { length: 36 }).notNull().references(() => businessProfile.id, { onDelete: 'cascade' }),
  customerId: varchar('customer_id', { length: 36 }).notNull().references(() => customer.id, { onDelete: 'cascade' }),
  leadId: varchar('lead_id', { length: 36 }).references(() => lead.id, { onDelete: 'set null' }),
  jobId: varchar('job_id', { length: 36 }).references(() => job.id, { onDelete: 'set null' }),
  status: varchar('status', { length: 30 }).notNull().default('draft'),
  subtotal: decimal('subtotal', { precision: 12, scale: 2 }).notNull().default('0.00'),
  taxTotal: decimal('tax_total', { precision: 12, scale: 2 }).notNull().default('0.00'),
  total: decimal('total', { precision: 12, scale: 2 }).notNull().default('0.00'),
  clientRequestId: varchar('client_request_id', { length: 36 }),
  notes: text('notes'),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
}, (table) => [uniqueIndex('estimate_tenant_request_unique').on(table.businessProfileId, table.clientRequestId)]);

export const invoice = mysqlTable('invoice', {
  id: varchar('id', { length: 36 }).primaryKey(),
  businessProfileId: varchar('business_profile_id', { length: 36 }).notNull().references(() => businessProfile.id, { onDelete: 'cascade' }),
  customerId: varchar('customer_id', { length: 36 }).notNull().references(() => customer.id, { onDelete: 'cascade' }),
  jobId: varchar('job_id', { length: 36 }).references(() => job.id, { onDelete: 'set null' }),
  status: varchar('status', { length: 30 }).notNull().default('draft'),
  subtotal: decimal('subtotal', { precision: 12, scale: 2 }).notNull().default('0.00'),
  taxTotal: decimal('tax_total', { precision: 12, scale: 2 }).notNull().default('0.00'),
  total: decimal('total', { precision: 12, scale: 2 }).notNull().default('0.00'),
  clientRequestId: varchar('client_request_id', { length: 36 }),
  notes: text('notes'),
  dueAt: timestamp('due_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
}, (table) => [uniqueIndex('invoice_tenant_request_unique').on(table.businessProfileId, table.clientRequestId)]);

export const quoteEmailDelivery = mysqlTable('quote_email_delivery', {
  id: varchar('id', { length: 36 }).primaryKey(),
  businessProfileId: varchar('business_profile_id', { length: 36 }).notNull().references(() => businessProfile.id, { onDelete: 'cascade' }),
  estimateId: varchar('estimate_id', { length: 36 }).notNull().references(() => estimate.id, { onDelete: 'cascade' }),
  requestId: varchar('request_id', { length: 36 }).notNull(),
  recipientEmail: varchar('recipient_email', { length: 255 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('sending'),
  providerMessageId: varchar('provider_message_id', { length: 255 }),
  providerStatus: varchar('provider_status', { length: 50 }),
  failureReason: varchar('failure_reason', { length: 500 }),
  acceptedAt: timestamp('accepted_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
}, (table) => [uniqueIndex('quote_email_request_unique').on(table.estimateId, table.requestId)]);

export const financeLineItem = mysqlTable('finance_line_item', {
  id: varchar('id', { length: 36 }).primaryKey(),
  estimateId: varchar('estimate_id', { length: 36 }).references(() => estimate.id, { onDelete: 'cascade' }),
  invoiceId: varchar('invoice_id', { length: 36 }).references(() => invoice.id, { onDelete: 'cascade' }),
  description: varchar('description', { length: 1000 }).notNull(),
  quantity: decimal('quantity', { precision: 12, scale: 2 }).notNull(),
  unitPrice: decimal('unit_price', { precision: 12, scale: 2 }).notNull(),
  subtotal: decimal('subtotal', { precision: 12, scale: 2 }).notNull(),
  taxRate: decimal('tax_rate', { precision: 7, scale: 4 }).notNull().default('0.0000'),
  taxAmount: decimal('tax_amount', { precision: 12, scale: 2 }).notNull().default('0.00'),
  total: decimal('total', { precision: 12, scale: 2 }).notNull(),
  position: int('position').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow(),
});

export const payment = mysqlTable('payment', {
  id: varchar('id', { length: 36 }).primaryKey(),
  businessProfileId: varchar('business_profile_id', { length: 36 }).notNull().references(() => businessProfile.id, { onDelete: 'cascade' }),
  customerId: varchar('customer_id', { length: 36 }).notNull().references(() => customer.id, { onDelete: 'cascade' }),
  invoiceId: varchar('invoice_id', { length: 36 }).references(() => invoice.id, { onDelete: 'set null' }),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  method: varchar('method', { length: 50 }),
  notes: text('notes'),
  status: varchar('status', { length: 30 }).notNull().default('pending'),
  receivedAt: timestamp('received_at'),
  createdAt: timestamp('created_at').defaultNow(),
});
export const businessSubscription = mysqlTable('business_subscription', {
  id: varchar('id', { length: 36 }).primaryKey(),
  businessProfileId: varchar('business_profile_id', { length: 36 }).notNull().unique().references(() => businessProfile.id, { onDelete: 'cascade' }),
  stripeCustomerId: varchar('stripe_customer_id', { length: 255 }).unique(),
  stripeSubscriptionId: varchar('stripe_subscription_id', { length: 255 }).unique(),
  stripePriceId: varchar('stripe_price_id', { length: 255 }),
  planKey: varchar('plan_key', { length: 40 }).notNull().default('trial'),
  status: varchar('status', { length: 50 }).notNull().default('trial'),
  trialStartsAt: timestamp('trial_starts_at'),
  trialEndsAt: timestamp('trial_ends_at'),
  currentPeriodEnd: timestamp('current_period_end'),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
});

export const stripeWebhookEvent = mysqlTable('stripe_webhook_event', {
  id: varchar('id', { length: 36 }).primaryKey(),
  stripeEventId: varchar('stripe_event_id', { length: 255 }).notNull().unique(),
  eventType: varchar('event_type', { length: 100 }).notNull(),
  stripeSubscriptionId: varchar('stripe_subscription_id', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const customerMessagingSettings = mysqlTable('customer_messaging_settings', {
  id: varchar('id', { length: 36 }).primaryKey(),
  businessProfileId: varchar('business_profile_id', { length: 36 }).notNull().unique().references(() => businessProfile.id, { onDelete: 'cascade' }),
  provider: varchar('provider', { length: 40 }).notNull().default('twilio_sms'),
  enabled: boolean('enabled').notNull().default(false),
  activatedAt: timestamp('activated_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
});

export const customerMessagingAction = mysqlTable('customer_messaging_action', {
  id: varchar('id', { length: 36 }).primaryKey(),
  businessProfileId: varchar('business_profile_id', { length: 36 }).notNull().references(() => businessProfile.id, { onDelete: 'cascade' }),
  customerId: varchar('customer_id', { length: 36 }).notNull().references(() => customer.id, { onDelete: 'cascade' }),
  sourceExternalId: varchar('source_external_id', { length: 255 }).notNull().unique(),
  actionType: varchar('action_type', { length: 40 }).notNull(),
  payload: text('payload').notNull(),
  status: varchar('status', { length: 30 }).notNull().default('pending'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
});


export const missedCallTextBack = mysqlTable('missed_call_text_back', {
  id: varchar('id', { length: 36 }).primaryKey(),
  businessProfileId: varchar('business_profile_id', { length: 36 }).notNull().references(() => businessProfile.id, { onDelete: 'cascade' }),
  customerId: varchar('customer_id', { length: 36 }).references(() => customer.id, { onDelete: 'set null' }),
  callSid: varchar('call_sid', { length: 255 }).notNull(),
  callerPhone: varchar('caller_phone', { length: 40 }).notNull(),
  businessNumber: varchar('business_number', { length: 40 }).notNull(),
  callStatus: varchar('call_status', { length: 60 }).notNull(),
  status: varchar('status', { length: 30 }).notNull().default('sending'),
  providerMessageSid: varchar('provider_message_sid', { length: 255 }),
  errorDetail: varchar('error_detail', { length: 500 }),
  sentAt: timestamp('sent_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
}, (table) => ({
  missedCallTextBackCallUnique: uniqueIndex('missed_call_text_back_call_unique').on(table.callSid),
}));

export const employee = mysqlTable('employee', {
  id: varchar('id', { length: 36 }).primaryKey(),
  businessProfileId: varchar('business_profile_id', { length: 36 }).notNull().references(() => businessProfile.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }),
  phoneNumber: varchar('phone_number', { length: 40 }),
  role: varchar('role', { length: 120 }),
  status: varchar('status', { length: 30 }).notNull().default('active'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
}, (table) => ({
  businessEmailUnique: uniqueIndex('employee_business_email_unique').on(table.businessProfileId, table.email),
}));

export const employeeAvailability = mysqlTable('employee_availability', {
  id: varchar('id', { length: 36 }).primaryKey(),
  businessProfileId: varchar('business_profile_id', { length: 36 }).notNull().references(() => businessProfile.id, { onDelete: 'cascade' }),
  employeeId: varchar('employee_id', { length: 36 }).notNull().references(() => employee.id, { onDelete: 'cascade' }),
  dayOfWeek: int('day_of_week').notNull(),
  startTime: varchar('start_time', { length: 5 }).notNull(),
  endTime: varchar('end_time', { length: 5 }).notNull(),
  isAvailable: boolean('is_available').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
}, (table) => ({
  employeeAvailabilityUnique: uniqueIndex('employee_availability_unique').on(table.employeeId, table.dayOfWeek, table.startTime, table.endTime),
}));

export const employeeTimeOffRequest = mysqlTable('employee_time_off_request', {
  id: varchar('id', { length: 36 }).primaryKey(),
  businessProfileId: varchar('business_profile_id', { length: 36 }).notNull().references(() => businessProfile.id, { onDelete: 'cascade' }),
  employeeId: varchar('employee_id', { length: 36 }).notNull().references(() => employee.id, { onDelete: 'cascade' }),
  startsAt: timestamp('starts_at').notNull(),
  endsAt: timestamp('ends_at').notNull(),
  status: varchar('status', { length: 30 }).notNull().default('pending'),
  notes: text('notes'),
  reviewedAt: timestamp('reviewed_at'),
  reviewedByUserId: varchar('reviewed_by_user_id', { length: 36 }).references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
});

export const weeklySchedule = mysqlTable('weekly_schedule', {
  id: varchar('id', { length: 36 }).primaryKey(),
  businessProfileId: varchar('business_profile_id', { length: 36 }).notNull().references(() => businessProfile.id, { onDelete: 'cascade' }),
  weekStartsAt: timestamp('week_starts_at').notNull(),
  status: varchar('status', { length: 30 }).notNull().default('draft'),
  publishedAt: timestamp('published_at'),
  publishedByUserId: varchar('published_by_user_id', { length: 36 }).references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
}, (table) => ({
  businessWeekUnique: uniqueIndex('weekly_schedule_business_week_unique').on(table.businessProfileId, table.weekStartsAt),
}));

export const scheduleTemplate = mysqlTable('schedule_template', {
  id: varchar('id', { length: 36 }).primaryKey(),
  businessProfileId: varchar('business_profile_id', { length: 36 }).notNull().references(() => businessProfile.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 120 }).notNull(),
  sourceWeekStartsAt: timestamp('source_week_starts_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
}, (table) => ({
  scheduleTemplateBusinessNameUnique: uniqueIndex('schedule_template_business_name_unique').on(table.businessProfileId, table.name),
}));

export const scheduleTemplateShift = mysqlTable('schedule_template_shift', {
  id: varchar('id', { length: 36 }).primaryKey(),
  scheduleTemplateId: varchar('schedule_template_id', { length: 36 }).notNull().references(() => scheduleTemplate.id, { onDelete: 'cascade' }),
  employeeId: varchar('employee_id', { length: 36 }).notNull().references(() => employee.id, { onDelete: 'cascade' }),
  startsAt: timestamp('starts_at').notNull(),
  endsAt: timestamp('ends_at').notNull(),
  location: varchar('location', { length: 255 }),
  notes: text('notes'),
});

export const employeeShift = mysqlTable('employee_shift', {
  id: varchar('id', { length: 36 }).primaryKey(),
  businessProfileId: varchar('business_profile_id', { length: 36 }).notNull().references(() => businessProfile.id, { onDelete: 'cascade' }),
  weeklyScheduleId: varchar('weekly_schedule_id', { length: 36 }).notNull().references(() => weeklySchedule.id, { onDelete: 'cascade' }),
  employeeId: varchar('employee_id', { length: 36 }).notNull().references(() => employee.id, { onDelete: 'cascade' }),
  startsAt: timestamp('starts_at').notNull(),
  endsAt: timestamp('ends_at').notNull(),
  location: varchar('location', { length: 255 }),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
});

export const scheduleEmailDelivery = mysqlTable('schedule_email_delivery', {
  id: varchar('id', { length: 36 }).primaryKey(),
  businessProfileId: varchar('business_profile_id', { length: 36 }).notNull().references(() => businessProfile.id, { onDelete: 'cascade' }),
  weeklyScheduleId: varchar('weekly_schedule_id', { length: 36 }).notNull().references(() => weeklySchedule.id, { onDelete: 'cascade' }),
  employeeId: varchar('employee_id', { length: 36 }).notNull().references(() => employee.id, { onDelete: 'cascade' }),
  recipientEmail: varchar('recipient_email', { length: 255 }).notNull(),
  gatewayMessageId: varchar('gateway_message_id', { length: 255 }).notNull(),
  sentAt: timestamp('sent_at').defaultNow().notNull(),
});
