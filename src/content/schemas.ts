import { z } from 'zod';
export const schemas = {
  site: z.object({
    "brandName": z.string(),
    "contactEmail": z.string(),
    "footer": z.object({
      "statement": z.string(),
      "supportLabel": z.string(),
      "supportEmail": z.string(),
      "copyright": z.string()
    }),
    "navigation": z.array(z.object({
      "label": z.string(),
      "href": z.string(),
      "id": z.string()
    })),
    "megaNavigation": z.object({
      "product": z.object({
        "label": z.string(),
        "description": z.string(),
        "actionLabel": z.string(),
        "actionHref": z.string(),
        "groups": z.array(z.object({
          "title": z.string(),
          "href": z.string(),
          "items": z.array(z.object({
            "label": z.string(),
            "id": z.string()
          })),
          "id": z.string()
        }))
      }),
      "solutions": z.object({
        "label": z.string(),
        "items": z.array(z.object({
          "label": z.string(),
          "href": z.string(),
          "id": z.string()
        }))
      }),
      "resources": z.object({
        "label": z.string(),
        "items": z.array(z.object({
          "label": z.string(),
          "href": z.string(),
          "id": z.string()
        }))
      }),
      "company": z.object({
        "label": z.string(),
        "items": z.array(z.object({
          "label": z.string(),
          "href": z.string(),
          "id": z.string()
        }))
      })
    }),
    "tagline": z.string()
  }),
  pages: {
    home: z.object({
      "hero": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "subtitle": z.string(),
        "primaryCta": z.string(),
        "secondaryCta": z.string(),
        "trustNote": z.string(),
        "phoneTitle": z.string(),
        "phoneSubtitle": z.string(),
        "customerOne": z.string(),
        "aiOne": z.string(),
        "customerTwo": z.string(),
        "aiTwo": z.string()
      }),
      "process": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string(),
        "steps": z.array(z.object({
          "id": z.string(),
          "number": z.string(),
          "title": z.string(),
          "description": z.string()
        }))
      }),
      "receptionist": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string(),
        "items": z.array(z.object({
          "id": z.string(),
          "label": z.string()
        })),
        "cta": z.string(),
        "callLabel": z.string(),
        "callName": z.string(),
        "callStatus": z.string()
      }),
      "demo": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string(),
        "customerOne": z.string(),
        "aiReply": z.string(),
        "customerTwo": z.string(),
        "leadTitle": z.string(),
        "leadName": z.string(),
        "leadPhone": z.string(),
        "leadAddress": z.string(),
        "leadService": z.string(),
        "leadStatus": z.string(),
        "caption": z.string()
      }),
      "dashboard": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string(),
        "cta": z.string(),
        "metrics": z.array(z.object({
          "id": z.string(),
          "value": z.string(),
          "label": z.string()
        })),
        "navigation": z.array(z.object({
          "id": z.string(),
          "label": z.string()
        })),
        "leads": z.array(z.object({
          "id": z.string(),
          "name": z.string(),
          "service": z.string(),
          "status": z.string()
        }))
      }),
      "insights": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string(),
        "metrics": z.array(z.object({
          "id": z.string(),
          "value": z.string(),
          "label": z.string()
        })),
        "statuses": z.array(z.object({
          "id": z.string(),
          "label": z.string(),
          "value": z.string()
        }))
      }),
      "benefits": z.object({
        "title": z.string(),
        "items": z.array(z.object({
          "id": z.string(),
          "title": z.string(),
          "description": z.string()
        }))
      }),
      "plans": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string(),
        "viewAll": z.string(),
        "items": z.array(z.object({
          "id": z.string(),
          "name": z.string(),
          "tagline": z.string(),
          "badge": z.string().optional(),
          "items": z.array(z.object({
            "id": z.string(),
            "label": z.string()
          })),
          "cta": z.string()
        }))
      }),
      "comparison": z.object({
        "title": z.string(),
        "withoutTitle": z.string(),
        "withTitle": z.string(),
        "without": z.array(z.object({
          "id": z.string(),
          "label": z.string()
        })),
        "with": z.array(z.object({
          "id": z.string(),
          "label": z.string()
        }))
      }),
      "cta": z.object({
        "title": z.string(),
        "description": z.string(),
        "primaryCta": z.string(),
        "secondaryCta": z.string()
      })
    }),
    solutions: z.object({
      "hero": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string(),
        "primaryCta": z.string(),
        "secondaryCta": z.string()
      }),
      "missedCalls": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string(),
        "cta": z.string(),
        "flow": z.array(z.object({
          "id": z.string(),
          "label": z.string()
        }))
      }),
      "aiConversations": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string(),
        "controlNote": z.string(),
        "items": z.array(z.object({
          "id": z.string(),
          "label": z.string()
        }))
      }),
      "leadCapture": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string(),
        "table": z.object({
          "headers": z.array(z.object({
            "id": z.string(),
            "label": z.string()
          })),
          "row": z.object({
            "customer": z.string(),
            "service": z.string(),
            "address": z.string(),
            "urgency": z.string(),
            "status": z.string()
          })
        })
      }),
      "followUps": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string(),
        "items": z.array(z.object({
          "id": z.string(),
          "label": z.string()
        }))
      }),
      "unified": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string(),
        "steps": z.array(z.object({
          "id": z.string(),
          "label": z.string()
        }))
      }),
      "industries": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "items": z.array(z.object({
          "id": z.string(),
          "title": z.string(),
          "description": z.string()
        }))
      }),
      "cta": z.object({
        "title": z.string(),
        "description": z.string(),
        "primaryCta": z.string(),
        "secondaryCta": z.string()
      })
    }),
    how_it_works: z.object({
      "hero": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string(),
        "flow": z.array(z.object({
          "label": z.string(),
          "id": z.string()
        }))
      }),
      "stepOne": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string(),
        "callLabel": z.string(),
        "customerLabel": z.string(),
        "customerMessage": z.string()
      }),
      "stepTwo": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string(),
        "messages": z.array(z.object({
          "sender": z.string(),
          "text": z.string(),
          "id": z.string()
        }))
      }),
      "stepThree": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string(),
        "leadLabel": z.string(),
        "lead": z.object({
          "customer": z.string(),
          "phone": z.string(),
          "address": z.string(),
          "service": z.string(),
          "priority": z.string()
        }),
        "items": z.array(z.object({
          "label": z.string(),
          "id": z.string()
        }))
      }),
      "stepFour": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string(),
        "headers": z.array(z.object({
          "label": z.string(),
          "id": z.string()
        })),
        "rows": z.array(z.object({
          "customer": z.string(),
          "service": z.string(),
          "status": z.string(),
          "id": z.string()
        }))
      }),
      "stepFive": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string(),
        "controlNote": z.string(),
        "humanTitle": z.string(),
        "humanText": z.string()
      }),
      "cta": z.object({
        "title": z.string(),
        "description": z.string(),
        "primary": z.string(),
        "secondary": z.string()
      })
    }),
    get_started: z.object({
      "meta": z.object({
        "title": z.string(),
        "description": z.string()
      }),
      "hero": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string()
      }),
      "fields": z.object({
        "firstName": z.string(),
        "lastName": z.string(),
        "email": z.string(),
        "password": z.string(),
        "confirmPassword": z.string()
      }),
      "placeholders": z.object({
        "firstName": z.string(),
        "lastName": z.string(),
        "email": z.string(),
        "password": z.string(),
        "confirmPassword": z.string()
      }),
      "actions": z.object({
        "submit": z.string(),
        "creating": z.string(),
        "login": z.string()
      }),
      "supporting": z.object({
        "account": z.string(),
        "notice": z.string()
      }),
      "errors": z.object({
        "passwordLength": z.string(),
        "passwordMatch": z.string(),
        "generic": z.string(),
        "signup": z.string()
      })
    }),
    welcome: z.object({
      "checklist": z.array(z.object({
        "label": z.string(),
        "state": z.string(),
        "id": z.string()
      })),
      "hero": z.object({
        "description": z.string(),
        "start": z.string(),
        "title": z.string()
      })
    }),
    features: z.object({
      "hero": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string(),
        "primaryCta": z.string(),
        "secondaryCta": z.string()
      }),
      "dashboard": z.object({
        "title": z.string(),
        "subtitle": z.string(),
        "metrics": z.array(z.object({
          "label": z.string(),
          "value": z.string(),
          "id": z.string()
        })),
        "conversations": z.array(z.object({
          "name": z.string(),
          "message": z.string(),
          "status": z.string(),
          "id": z.string()
        })),
        "insights": z.array(z.object({
          "label": z.string(),
          "value": z.string(),
          "id": z.string()
        }))
      }),
      "sections": z.array(z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string(),
        "items": z.array(z.object({
          "label": z.string(),
          "id": z.string()
        })),
        "id": z.string()
      })),
      "memory": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string(),
        "details": z.array(z.object({
          "label": z.string(),
          "id": z.string()
        })),
        "callLabel": z.string(),
        "caller": z.string(),
        "assistantLabel": z.string(),
        "welcomeMessage": z.string(),
        "profileName": z.string(),
        "customerSince": z.string(),
        "address": z.string(),
        "phone": z.string(),
        "servicesTitle": z.string(),
        "services": z.array(z.object({
          "label": z.string(),
          "id": z.string()
        })),
        "lastConversationTitle": z.string(),
        "lastConversation": z.string(),
        "closing": z.string()
      }),
      "summary": z.object({
        "title": z.string(),
        "items": z.array(z.object({
          "label": z.string(),
          "id": z.string()
        }))
      }),
      "cta": z.object({
        "title": z.string(),
        "description": z.string(),
        "primaryCta": z.string(),
        "secondaryCta": z.string()
      })
    }),
    pricing: z.object({
      "hero": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string()
      }),
      "plans": z.array(z.object({
        "name": z.string(),
        "tagline": z.string(),
        "description": z.string(),
        "monthlyPrice": z.string(),
        "monthlySuffix": z.string(),
        "yearlyMonthlyPrice": z.string(),
        "yearlyMonthlySuffix": z.string(),
        "yearlyPrice": z.string(),
        "savingsLabel": z.string(),
        "features": z.array(z.object({
          "label": z.string(),
          "id": z.string()
        })),
        "cta": z.string(),
        "id": z.string()
      })),
      "comparison": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "features": z.array(z.object({
          "name": z.string(),
          "essential": z.boolean(),
          "growth": z.boolean(),
          "pro": z.boolean(),
          "id": z.string()
        }))
      }),
      "faq": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "items": z.array(z.object({
          "question": z.string(),
          "answer": z.string(),
          "id": z.string()
        }))
      }),
      "cta": z.object({
        "title": z.string(),
        "description": z.string(),
        "primaryCta": z.string(),
        "secondaryCta": z.string()
      })
    }),
    about: z.object({
      "hero": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string(),
        "primaryCta": z.string(),
        "secondaryCta": z.string()
      }),
      "story": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "paragraphs": z.array(z.object({
          "text": z.string(),
          "id": z.string()
        }))
      }),
      "mission": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string()
      }),
      "beliefs": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "items": z.array(z.object({
          "title": z.string(),
          "description": z.string(),
          "id": z.string()
        }))
      }),
      "platform": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string(),
        "steps": z.array(z.object({
          "label": z.string(),
          "id": z.string()
        })),
        "closing": z.string()
      }),
      "difference": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string(),
        "items": z.array(z.object({
          "label": z.string(),
          "id": z.string()
        })),
        "highlight": z.string()
      }),
      "vision": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string(),
        "items": z.array(z.object({
          "label": z.string(),
          "id": z.string()
        })),
        "closing": z.string()
      }),
      "cta": z.object({
        "title": z.string(),
        "description": z.string(),
        "primaryCta": z.string(),
        "secondaryCta": z.string(),
        "brandStatement": z.string()
      })
    }),
    dashboard: z.object({
      "hero": z.object({
        "greeting": z.string(),
        "subtitle": z.string(),
        "overviewLabel": z.string(),
        "openSchedule": z.string(),
        "openLeads": z.string()
      }),
      "summary": z.object({
        "title": z.string(),
        "description": z.string(),
        "todaySchedule": z.object({
          "label": z.string(),
          "detail": z.string()
        }),
        "openLeads": z.object({
          "label": z.string(),
          "detail": z.string()
        }),
        "activeJobs": z.object({
          "label": z.string(),
          "detail": z.string()
        }),
        "unpaidBalance": z.object({
          "label": z.string(),
          "detail": z.string()
        }),
        "revenue": z.object({
          "label": z.string(),
          "detail": z.string()
        })
      }),
      "schedule": z.object({
        "title": z.string(),
        "description": z.string(),
        "emptyTitle": z.string(),
        "emptyDescription": z.string(),
        "open": z.string(),
        "customer": z.string(),
        "service": z.string(),
        "time": z.string(),
        "status": z.string()
      }),
      "attention": z.object({
        "title": z.string(),
        "description": z.string(),
        "emptyTitle": z.string(),
        "emptyDescription": z.string(),
        "open": z.string(),
        "followUp": z.string(),
        "cancelled": z.string(),
        "unread": z.string()
      }),
      "pipeline": z.object({
        "title": z.string(),
        "description": z.string(),
        "leads": z.object({
          "label": z.string(),
          "detail": z.string()
        }),
        "jobs": z.object({
          "label": z.string(),
          "detail": z.string()
        }),
        "estimates": z.object({
          "label": z.string(),
          "detail": z.string()
        }),
        "invoices": z.object({
          "label": z.string(),
          "detail": z.string()
        }),
        "emptyFinance": z.string()
      }),
      "activity": z.object({
        "title": z.string(),
        "description": z.string(),
        "emptyTitle": z.string(),
        "emptyDescription": z.string(),
        "openCustomer": z.string()
      }),
      "briefing": z.object({
        "title": z.string(),
        "description": z.string(),
        "emptyTitle": z.string(),
        "emptyDescription": z.string(),
        "todayAppointments": z.string(),
        "attentionItems": z.string(),
        "openLeads": z.string(),
        "activeJobs": z.string()
      }),
      "status": z.object({
        "unknown": z.string(),
        "overdue": z.string(),
        "noStoredRevenue": z.string()
      })
    }),
    customer_profile: z.object({
      "navigation": z.object({
        "back": z.string(),
        "viewConversation": z.string(),
        "openCalendar": z.string(),
        "viewAppointment": z.string(),
        "reschedule": z.string()
      }),
      "headings": z.object({
        "recentActivity": z.string(),
        "details": z.string(),
        "notes": z.string(),
        "upcoming": z.string(),
        "noUpcoming": z.string(),
        "activityEmpty": z.string(),
        "notesEmpty": z.string(),
        "serviceHistory": z.string(),
        "serviceHistoryDescription": z.string(),
        "financialRecords": z.string(),
        "financialRecordsDescription": z.string(),
        "financialEmpty": z.string(),
        "jobsEmpty": z.string()
      }),
      "labels": z.object({
        "active": z.string(),
        "phone": z.string(),
        "email": z.string(),
        "address": z.string(),
        "preferredContact": z.string(),
        "totalAppointments": z.string(),
        "customerStatus": z.string(),
        "customerSince": z.string(),
        "lastContact": z.string(),
        "nextAppointment": z.string(),
        "upcomingAppointments": z.string(),
        "appointmentStatus": z.string(),
        "service": z.string(),
        "date": z.string(),
        "time": z.string(),
        "notAvailable": z.string(),
        "unknown": z.string(),
        "notScheduled": z.string(),
        "privateNote": z.string(),
        "addNote": z.string(),
        "saveNote": z.string(),
        "jobs": z.string(),
        "estimates": z.string(),
        "invoices": z.string(),
        "paymentsReceived": z.string(),
        "amount": z.string(),
        "status": z.string(),
        "recorded": z.string(),
        "estimated": z.string(),
        "invoiced": z.string(),
        "paid": z.string()
      })
    }),
    contact: z.object({
      "hero": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string()
      }),
      "details": z.object({
        "title": z.string(),
        "description": z.string(),
        "emailLabel": z.string(),
        "email": z.string(),
        "responseTitle": z.string(),
        "responseDescription": z.string()
      }),
      "form": z.object({
        "title": z.string(),
        "description": z.string(),
        "name": z.string(),
        "email": z.string(),
        "company": z.string(),
        "phone": z.string(),
        "teamSize": z.string(),
        "teamOptions": z.array(z.string()),
        "interest": z.string(),
        "interestOptions": z.array(z.string()),
        "message": z.string(),
        "submit": z.string(),
        "sending": z.string(),
        "success": z.string(),
        "error": z.string()
      })
    }),
    index: z.object({
      "hero": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "subtitle": z.string(),
        "tagline": z.string(),
        "primaryCta": z.string(),
        "secondaryCta": z.string(),
        "hubDetail": z.string(),
        "nodes": z.array(z.object({
          "id": z.string(),
          "label": z.string(),
          "icon": z.string()
        }))
      }),
      "intro": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string(),
        "pillars": z.array(z.object({
          "id": z.string(),
          "label": z.string(),
          "icon": z.string()
        }))
      }),
      "appointments": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "subtitle": z.string(),
        "capabilities": z.array(z.object({
          "id": z.string(),
          "text": z.string()
        })),
        "closing": z.string()
      }),
      "marketing": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "subtitle": z.string(),
        "description": z.string(),
        "capabilities": z.array(z.object({
          "id": z.string(),
          "label": z.string()
        })),
        "upcomingNote": z.string(),
        "cta": z.string()
      }),
      "insights": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "subtitle": z.string(),
        "description": z.string(),
        "exampleNote": z.string(),
        "examples": z.array(z.object({
          "id": z.string(),
          "text": z.string(),
          "kind": z.string()
        }))
      }),
      "scheduling": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "subtitle": z.string(),
        "description": z.string(),
        "features": z.array(z.object({
          "id": z.string(),
          "label": z.string(),
          "icon": z.string()
        }))
      }),
      "chat": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "subtitle": z.string(),
        "disclaimer": z.string(),
        "messages": z.array(z.object({
          "id": z.string(),
          "role": z.string(),
          "text": z.string()
        }))
      }),
      "value": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string(),
        "body": z.string(),
        "closing": z.string(),
        "pillars": z.array(z.object({
          "id": z.string(),
          "headline": z.string(),
          "detail": z.string()
        }))
      }),
      "cta": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "subtitle": z.string(),
        "description": z.string(),
        "closing": z.string(),
        "primaryCta": z.string()
      })
    }),
    business_profile: z.object({
      "seo": z.object({
        "title": z.string(),
        "description": z.string()
      }),
      "navigation": z.object({
        "back": z.string(),
        "setup": z.string()
      }),
      "loading": z.string(),
      "hero": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string()
      }),
      "setup": z.object({
        "title": z.string(),
        "description": z.string(),
        "tellTitle": z.string(),
        "tellDescription": z.string(),
        "fileTitle": z.string(),
        "fileDescription": z.string(),
        "websiteTitle": z.string(),
        "websiteDescription": z.string(),
        "reviewTitle": z.string(),
        "reviewDescription": z.string(),
        "tellPlaceholder": z.string(),
        "websitePlaceholder": z.string(),
        "uploadHelp": z.string(),
        "extract": z.string(),
        "extracting": z.string(),
        "saveSuggestions": z.string(),
        "saving": z.string(),
        "discard": z.string()
      }),
      "teachPilot": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string(),
        "uploadTitle": z.string(),
        "uploadDescription": z.string(),
        "tellTitle": z.string(),
        "tellDescription": z.string(),
        "tellAction": z.string(),
        "recentTitle": z.string(),
        "recentDescription": z.string(),
        "recentEmpty": z.string(),
        "reviewTitle": z.string(),
        "reviewDescription": z.string(),
        "uploadAction": z.string(),
        "uploading": z.string(),
        "saveAction": z.string(),
        "saving": z.string(),
        "discard": z.string(),
        "unsupported": z.string()
      }),
      "sections": z.object({
        "core": z.string(),
        "coreDescription": z.string(),
        "knowledge": z.string(),
        "knowledgeDescription": z.string(),
        "advanced": z.string()
      }),
      "fields": z.object({
        "businessName": z.string(),
        "industry": z.string(),
        "businessEmail": z.string(),
        "website": z.string(),
        "address": z.string(),
        "city": z.string(),
        "region": z.string(),
        "postalCode": z.string(),
        "serviceArea": z.string(),
        "hours": z.string(),
        "services": z.string(),
        "pricing": z.string(),
        "faqs": z.string(),
        "policies": z.string(),
        "instructions": z.string(),
        "discloseAutomation": z.string(),
        "discloseAutomationHelp": z.string()
      }),
      "actions": z.object({
        "save": z.string(),
        "saved": z.string(),
        "reviewSaved": z.string()
      }),
      "errors": z.object({
        "load": z.string(),
        "save": z.string(),
        "extract": z.string()
      })
    }),
    phone_connection: z.object({
      "seo": z.object({
        "title": z.string(),
        "description": z.string()
      }),
      "hero": z.object({
        "eyebrow": z.string(),
        "badge": z.string(),
        "title": z.string(),
        "description": z.string()
      }),
      "status": z.object({
        "title": z.string(),
        "description": z.string(),
        "action": z.string()
      })
    }),
    auth: z.object({
      "login": z.object({
        "title": z.string()
      }),
      "signup": z.object({
        "title": z.string()
      })
    }),
    password_reset: z.object({
      "forgot": z.object({
        "seo": z.object({
          "title": z.string(),
          "description": z.string()
        }),
        "title": z.string(),
        "description": z.string(),
        "emailLabel": z.string(),
        "submit": z.string(),
        "sent": z.string(),
        "back": z.string()
      }),
      "reset": z.object({
        "seo": z.object({
          "title": z.string(),
          "description": z.string()
        }),
        "title": z.string(),
        "description": z.string(),
        "passwordLabel": z.string(),
        "confirmLabel": z.string(),
        "submit": z.string(),
        "success": z.string(),
        "invalid": z.string()
      })
    }),
    workspace: z.object({
      "eyebrow": z.string(),
      "title": z.string(),
      "welcomePrefix": z.string(),
      "welcomeSuffix": z.string(),
      "manageBusiness": z.string(),
      "addCustomer": z.string(),
      "stats": z.array(z.object({
        "label": z.string(),
        "id": z.string()
      })),
      "scheduleEyebrow": z.string(),
      "appointmentsTitle": z.string(),
      "appointmentsDescription": z.string(),
      "connectNumber": z.string(),
      "loadingAppointments": z.string(),
      "noAppointments": z.string(),
      "openCustomer": z.string(),
      "receptionistEyebrow": z.string(),
      "receptionistActive": z.string(),
      "receptionistSetup": z.string(),
      "receptionistActiveDescription": z.string(),
      "receptionistSetupDescription": z.string(),
      "manageReceptionist": z.string(),
      "activityEyebrow": z.string(),
      "activityTitle": z.string(),
      "loadingActivity": z.string(),
      "noActivity": z.string(),
      "customerEyebrow": z.string(),
      "customersTitle": z.string(),
      "customersDescription": z.string(),
      "loadingCustomers": z.string(),
      "noCustomers": z.string(),
      "createCustomerTitle": z.string(),
      "createCustomerDescription": z.string(),
      "close": z.string(),
      "customerName": z.string(),
      "phoneNumber": z.string(),
      "email": z.string(),
      "tags": z.string(),
      "tagsHint": z.string(),
      "cancel": z.string(),
      "create": z.string(),
      "saving": z.string()
    }),
    calendar: z.object({
      "title": z.string(),
      "description": z.string(),
      "newAppointment": z.string(),
      "today": z.string(),
      "availability": z.string(),
      "month": z.string(),
      "week": z.string(),
      "day": z.string(),
      "empty": z.string(),
      "details": z.string(),
      "edit": z.string(),
      "cancel": z.string(),
      "save": z.string(),
      "create": z.string(),
      "customer": z.string(),
      "service": z.string(),
      "date": z.string(),
      "duration": z.string(),
      "notes": z.string(),
      "status": z.string(),
      "close": z.string(),
      "previous": z.string(),
      "next": z.string()
    }),
    customers: z.object({
      "hero": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string(),
        "addButton": z.string()
      }),
      "summary": z.object({
        "total": z.string(),
        "new": z.string(),
        "returning": z.string(),
        "upcoming": z.string()
      }),
      "filters": z.object({
        "search": z.string(),
        "all": z.string(),
        "apply": z.string()
      }),
      "empty": z.object({
        "title": z.string(),
        "description": z.string()
      }),
      "form": z.object({
        "title": z.string(),
        "description": z.string(),
        "save": z.string()
      })
    }),
    checkout: z.object({
      "success": z.object({
        "workspaceCta": z.string(),
        "title": z.string(),
        "description": z.string()
      }),
      "cancel": z.object({
        "title": z.string(),
        "description": z.string()
      })
    }),
    notifications: z.object({
      "meta": z.object({
        "title": z.string(),
        "description": z.string()
      }),
      "hero": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string()
      }),
      "empty": z.object({
        "title": z.string(),
        "description": z.string()
      }),
      "labels": z.object({
        "new": z.string(),
        "original": z.string(),
        "updated": z.string(),
        "markRead": z.string(),
        "openProfile": z.string(),
        "unavailable": z.string()
      })
    }),
    booking_rules: z.object({
      "seo": z.object({
        "title": z.string(),
        "description": z.string()
      }),
      "navigation": z.object({
        "back": z.string()
      }),
      "hero": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string()
      }),
      "sections": z.object({
        "appointments": z.string(),
        "availability": z.string()
      }),
      "fields": z.object({
        "duration": z.string(),
        "durationHelp": z.string(),
        "buffer": z.string(),
        "bufferHelp": z.string(),
        "overlaps": z.string(),
        "overlapsNo": z.string(),
        "overlapsYes": z.string(),
        "minimumNotice": z.string(),
        "minimumNoticeHelp": z.string(),
        "bookingWindow": z.string(),
        "bookingWindowHelp": z.string(),
        "sameDay": z.string(),
        "sameDayAllow": z.string(),
        "sameDayDisallow": z.string(),
        "rescheduling": z.string(),
        "cancellations": z.string(),
        "anytime": z.string(),
        "notice": z.string(),
        "disabledRescheduling": z.string(),
        "disabledCancellations": z.string(),
        "hours": z.string(),
        "hoursHelp": z.string(),
        "closed": z.string()
      }),
      "actions": z.object({
        "save": z.string(),
        "saving": z.string(),
        "saved": z.string()
      }),
      "errors": z.object({
        "load": z.string(),
        "save": z.string()
      }),
      "days": z.array(z.object({
        "key": z.string(),
        "label": z.string(),
        "id": z.string()
      })),
      "durationOptions": z.array(z.number()),
      "bufferOptions": z.array(z.number())
    }),
    account_profile: z.object({
      "meta": z.object({
        "title": z.string(),
        "description": z.string()
      }),
      "hero": z.object({
        "title": z.string(),
        "description": z.string()
      }),
      "fields": z.object({
        "name": z.string(),
        "email": z.string(),
        "currentPassword": z.string(),
        "newPassword": z.string(),
        "confirmPassword": z.string()
      }),
      "actions": z.object({
        "saveProfile": z.string(),
        "changePassword": z.string()
      }),
      "notices": z.object({
        "profileSaved": z.string(),
        "passwordSaved": z.string()
      })
    }),
    settings: z.object({
      "meta": z.object({
        "title": z.string(),
        "description": z.string()
      }),
      "hero": z.object({
        "title": z.string(),
        "description": z.string()
      }),
      "cards": z.array(z.object({
        "title": z.string(),
        "description": z.string(),
        "action": z.string(),
        "href": z.string(),
        "id": z.string()
      }))
    }),
    help: z.object({
      "meta": z.object({
        "title": z.string(),
        "description": z.string()
      }),
      "hero": z.object({
        "title": z.string(),
        "description": z.string()
      }),
      "topics": z.array(z.object({
        "title": z.string(),
        "description": z.string(),
        "href": z.string(),
        "action": z.string(),
        "id": z.string()
      })),
      "support": z.object({
        "title": z.string(),
        "description": z.string(),
        "action": z.string(),
        "href": z.string()
      })
    }),
    messages: z.object({
      "hero": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string()
      }),
      "meta": z.object({
        "title": z.string(),
        "description": z.string()
      }),
      "empty": z.object({
        "title": z.string(),
        "description": z.string()
      }),
      "labels": z.object({
        "openCustomer": z.string(),
        "inbound": z.string(),
        "outbound": z.string(),
        "aiMessaging": z.string(),
        "comingSoon": z.string(),
        "proRequired": z.string(),
        "active": z.string(),
        "activate": z.string(),
        "deactivate": z.string(),
        "provider": z.string(),
        "notConnected": z.string(),
        "deliveryNote": z.string()
      })
    }),
    ai_receptionist: z.object({
      "hero": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string(),
        "action": z.string()
      }),
      "overview": z.object({
        "title": z.string(),
        "active": z.string(),
        "inactive": z.string(),
        "calls": z.string(),
        "bookings": z.string(),
        "messages": z.string()
      }),
      "setup": z.object({
        "title": z.string(),
        "test": z.string()
      }),
      "training": z.object({
        "title": z.string(),
        "description": z.string()
      }),
      "voice": z.object({
        "title": z.string(),
        "description": z.string()
      }),
      "booking": z.object({
        "title": z.string(),
        "description": z.string()
      }),
      "test": z.object({
        "title": z.string(),
        "description": z.string()
      })
    }),
    assistant: z.object({
      "hero": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string()
      }),
      "chat": z.object({
        "title": z.string(),
        "description": z.string(),
        "placeholder": z.string(),
        "send": z.string(),
        "thinking": z.string(),
        "greeting": z.string(),
        "subgreeting": z.string(),
        "suggestions": z.array(z.object({
          "prompt": z.string(),
          "id": z.string()
        }))
      }),
      "capabilities": z.object({
        "title": z.string(),
        "items": z.array(z.object({
          "icon": z.string(),
          "title": z.string(),
          "description": z.string(),
          "id": z.string()
        }))
      }),
      "receptionist": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string(),
        "action": z.string(),
        "training": z.string()
      }),
      "quickActions": z.object({
        "title": z.string(),
        "actions": z.array(z.object({
          "label": z.string(),
          "prompt": z.string(),
          "id": z.string()
        }))
      })
    }),
    home_pilot: z.object({
      "eyebrow": z.string(),
      "title": z.string(),
      "description": z.string(),
      "privacyNote": z.string(),
      "greeting": z.string(),
      "capabilitiesTitle": z.string(),
      "actions": z.array(z.object({
        "icon": z.string(),
        "title": z.string(),
        "description": z.string(),
        "id": z.string()
      })),
      "chatTitle": z.string(),
      "chatSubtitle": z.string(),
      "chatMessages": z.array(z.object({
        "speaker": z.string(),
        "content": z.string(),
        "role": z.string(),
        "id": z.string()
      })),
      "ctaTitle": z.string(),
      "ctaDetail": z.string(),
      "cta": z.string()
    }),
    onboarding_pilot: z.object({
      "eyebrow": z.string(),
      "title": z.string(),
      "subtitle": z.string(),
      "description": z.string(),
      "steps": z.array(z.object({
        "title": z.string(),
        "description": z.string(),
        "id": z.string()
      })),
      "promptTitle": z.string(),
      "promptDescription": z.string(),
      "placeholder": z.string(),
      "response": z.string(),
      "continue": z.string(),
      "skip": z.string()
    }),
    resources: z.object({
      "pilot": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string(),
        "audienceNote": z.string(),
        "greeting": z.string(),
        "capabilitiesTitle": z.string(),
        "highlights": z.array(z.object({
          "title": z.string(),
          "description": z.string(),
          "id": z.string()
        })),
        "chatTitle": z.string(),
        "chatSubtitle": z.string(),
        "chatMessages": z.array(z.object({
          "speaker": z.string(),
          "content": z.string(),
          "role": z.string(),
          "id": z.string()
        })),
        "ctaTitle": z.string(),
        "ctaDescription": z.string(),
        "cta": z.string()
      }),
      "receptionist": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string(),
        "highlights": z.array(z.object({
          "title": z.string(),
          "description": z.string(),
          "id": z.string()
        })),
        "cta": z.string()
      }),
      "customers": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string(),
        "highlights": z.array(z.object({
          "title": z.string(),
          "description": z.string(),
          "id": z.string()
        })),
        "cta": z.string()
      }),
      "faqs": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string(),
        "questions": z.array(z.object({
          "question": z.string(),
          "answer": z.string(),
          "id": z.string()
        })),
        "cta": z.string()
      }),
      "help": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string(),
        "highlights": z.array(z.object({
          "title": z.string(),
          "description": z.string(),
          "id": z.string()
        })),
        "cta": z.string()
      })
    }),
    leads: z.object({
      "seo": z.object({
        "title": z.string(),
        "description": z.string()
      }),
      "hero": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string(),
        "addButton": z.string()
      }),
      "summary": z.object({
        "all": z.string(),
        "new": z.string(),
        "followUp": z.string(),
        "won": z.string()
      }),
      "filters": z.object({
        "search": z.string(),
        "allStatuses": z.string(),
        "apply": z.string()
      }),
      "table": z.object({
        "lead": z.string(),
        "service": z.string(),
        "status": z.string(),
        "value": z.string(),
        "assigned": z.string(),
        "lastContact": z.string(),
        "action": z.string(),
        "open": z.string()
      }),
      "empty": z.object({
        "title": z.string(),
        "description": z.string()
      }),
      "form": z.object({
        "title": z.string(),
        "description": z.string(),
        "name": z.string(),
        "phone": z.string(),
        "email": z.string(),
        "service": z.string(),
        "address": z.string(),
        "source": z.string(),
        "value": z.string(),
        "assigned": z.string(),
        "notes": z.string(),
        "cancel": z.string(),
        "save": z.string(),
        "saving": z.string()
      }),
      "detail": z.object({
        "title": z.string(),
        "description": z.string(),
        "activity": z.string(),
        "activityEmpty": z.string(),
        "note": z.string(),
        "saveChanges": z.string(),
        "savingChanges": z.string(),
        "convert": z.string(),
        "convertDescription": z.string(),
        "createJob": z.string(),
        "confirmConvert": z.string(),
        "close": z.string()
      }),
      "statuses": z.array(z.object({
        "id": z.string(),
        "label": z.string()
      }))
    }),
    jobs: z.object({
      "seo": z.object({
        "title": z.string(),
        "description": z.string()
      }),
      "hero": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string(),
        "addButton": z.string()
      }),
      "summary": z.object({
        "all": z.string(),
        "booked": z.string(),
        "inProgress": z.string(),
        "complete": z.string()
      }),
      "filters": z.object({
        "search": z.string(),
        "allStatuses": z.string(),
        "apply": z.string()
      }),
      "table": z.object({
        "job": z.string(),
        "customer": z.string(),
        "scheduled": z.string(),
        "assigned": z.string(),
        "status": z.string(),
        "action": z.string(),
        "open": z.string()
      }),
      "empty": z.object({
        "title": z.string(),
        "description": z.string()
      }),
      "form": z.object({
        "title": z.string(),
        "description": z.string(),
        "customer": z.string(),
        "service": z.string(),
        "address": z.string(),
        "assigned": z.string(),
        "scheduled": z.string(),
        "duration": z.string(),
        "status": z.string(),
        "notes": z.string(),
        "cancel": z.string(),
        "save": z.string(),
        "saving": z.string()
      }),
      "detail": z.object({
        "title": z.string(),
        "activity": z.string(),
        "activityEmpty": z.string(),
        "save": z.string(),
        "saving": z.string(),
        "close": z.string()
      }),
      "statuses": z.array(z.object({
        "id": z.string(),
        "label": z.string()
      }))
    }),
    finance: z.object({
      "seo": z.object({
        "title": z.string(),
        "description": z.string()
      }),
      "hero": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string(),
        "addEstimate": z.string(),
        "addInvoice": z.string(),
        "recordPayment": z.string(),
        "addFile": z.string()
      }),
      "tabs": z.array(z.object({
        "id": z.string(),
        "label": z.string()
      })),
      "summary": z.object({
        "estimated": z.string(),
        "invoiced": z.string(),
        "received": z.string(),
        "outstanding": z.string()
      }),
      "empty": z.object({
        "estimates": z.object({
          "title": z.string(),
          "description": z.string()
        }),
        "invoices": z.object({
          "title": z.string(),
          "description": z.string()
        }),
        "payments": z.object({
          "title": z.string(),
          "description": z.string()
        }),
        "jobFiles": z.object({
          "title": z.string(),
          "description": z.string()
        })
      }),
      "form": z.object({
        "customer": z.string(),
        "job": z.string(),
        "amount": z.string(),
        "status": z.string(),
        "notes": z.string(),
        "dueDate": z.string(),
        "expiresDate": z.string(),
        "method": z.string(),
        "receivedDate": z.string(),
        "fileName": z.string(),
        "fileUrl": z.string(),
        "fileType": z.string(),
        "save": z.string(),
        "cancel": z.string()
      }),
      "status": z.object({
        "draft": z.string(),
        "sent": z.string(),
        "accepted": z.string(),
        "declined": z.string(),
        "open": z.string(),
        "paid": z.string(),
        "overdue": z.string(),
        "void": z.string(),
        "pending": z.string(),
        "completed": z.string(),
        "refunded": z.string()
      }),
      "table": z.object({
        "record": z.string(),
        "customer": z.string(),
        "job": z.string(),
        "amount": z.string(),
        "balance": z.string(),
        "status": z.string(),
        "date": z.string(),
        "action": z.string(),
        "open": z.string(),
        "delete": z.string(),
        "download": z.string()
      }),
      "messages": z.object({
        "loading": z.string(),
        "saveError": z.string(),
        "deleteConfirm": z.string(),
        "noJob": z.string(),
        "noCustomerInvoice": z.string(),
        "externalAttachment": z.string()
      })
    }),
    onboarding: z.object({
      "meta": z.object({
        "title": z.string(),
        "description": z.string()
      }),
      "hero": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string(),
        "pilotMessage": z.string()
      }),
      "prompt": z.object({
        "label": z.string(),
        "placeholder": z.string(),
        "helper": z.string()
      }),
      "supplemental": z.object({
        "title": z.string(),
        "description": z.string(),
        "websiteLabel": z.string(),
        "websitePlaceholder": z.string(),
        "fileLabel": z.string(),
        "fileHelp": z.string(),
        "website": z.string(),
        "file": z.string()
      }),
      "review": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string(),
        "name": z.string(),
        "type": z.string(),
        "location": z.string(),
        "hours": z.string(),
        "services": z.string()
      }),
      "actions": z.object({
        "review": z.string(),
        "reviewing": z.string(),
        "confirm": z.string(),
        "saving": z.string(),
        "startOver": z.string(),
        "skip": z.string()
      }),
      "notice": z.string(),
      "status": z.object({
        "loading": z.string(),
        "setupCheck": z.string(),
        "save": z.string(),
        "generic": z.string()
      }),
      "errors": z.object({
        "preview": z.string(),
        "missing": z.string(),
        "file": z.string()
      })
    }),
    operations: z.object({
      "orders": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string(),
        "newRecord": z.string(),
        "empty": z.string(),
        "emptyDescription": z.string()
      }),
      "jobs": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string(),
        "newRecord": z.string(),
        "empty": z.string(),
        "emptyDescription": z.string()
      })
    }),
    connections: z.object({
      "seo": z.object({
        "title": z.string(),
        "description": z.string()
      }),
      "hero": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string(),
        "connect": z.string()
      }),
      "notice": z.object({
        "title": z.string(),
        "description": z.string()
      }),
      "connected": z.object({
        "title": z.string(),
        "description": z.string(),
        "emptyTitle": z.string(),
        "emptyDescription": z.string(),
        "disconnect": z.string(),
        "willUse": z.string()
      }),
      "available": z.object({
        "title": z.string(),
        "description": z.string(),
        "searchLabel": z.string(),
        "searchPlaceholder": z.string(),
        "noResults": z.string(),
        "connect": z.string(),
        "working": z.string()
      }),
      "categories": z.array(z.object({
        "id": z.string(),
        "name": z.string(),
        "tools": z.array(z.object({
          "id": z.string(),
          "name": z.string(),
          "description": z.string(),
          "data": z.string()
        }))
      }))
    }),
    phone_ai_receptionist: z.object({
      "seo": z.object({
        "title": z.string(),
        "description": z.string()
      }),
      "hero": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string()
      }),
      "receptionist": z.object({
        "title": z.string(),
        "description": z.string(),
        "badge": z.string(),
        "disabledAction": z.string(),
        "note": z.string()
      }),
      "availability": z.object({
        "title": z.string(),
        "items": z.array(z.object({
          "title": z.string(),
          "description": z.string(),
          "id": z.string()
        }))
      })
    }),
    scheduling: z.object({
      "actions": z.object({
        "add": z.string(),
        "addEmployee": z.string(),
        "cancel": z.string(),
        "delete": z.string(),
        "draft": z.string(),
        "edit": z.string(),
        "email": z.string(),
        "next": z.string(),
        "previous": z.string(),
        "publish": z.string(),
        "save": z.string()
      }),
      "empty": z.string(),
      "hero": z.object({
        "description": z.string(),
        "eyebrow": z.string(),
        "title": z.string()
      }),
      "seo": z.object({
        "description": z.string(),
        "title": z.string()
      })
    }),
    subscription: z.object({
      "hero": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string()
      }),
      "seo": z.object({
        "title": z.string(),
        "description": z.string()
      }),
      "actions": z.object({
        "choose": z.string(),
        "manage": z.string(),
        "back": z.string()
      }),
      "testBilling": z.object({
        "title": z.string(),
        "description": z.string(),
        "reset": z.string(),
        "resetting": z.string(),
        "confirm": z.string(),
        "success": z.string()
      }),
      "featureLabels": z.object({
        "customers": z.string(),
        "leads": z.string(),
        "orders_jobs": z.string(),
        "scheduling": z.string(),
        "finance": z.string(),
        "payments": z.string(),
        "business_knowledge": z.string(),
        "pilot_assistant": z.string(),
        "basic_insights": z.string(),
        "connections": z.string(),
        "advanced_insights": z.string(),
        "proactive_pilot": z.string(),
        "pilot_actions": z.string(),
        "ai_customer_messaging": z.string(),
        "advanced_automation": z.string(),
        "advanced_forecasting": z.string(),
        "advanced_pilot_actions": z.string(),
        "ai_phone_receptionist": z.string()
      })
    }),
    public_messaging: z.object({
      "pricing": z.object({
        "hero": z.object({
          "eyebrow": z.string(),
          "title": z.string(),
          "description": z.string()
        }),
        "plans": z.array(z.object({
          "id": z.string(),
          "name": z.string(),
          "tagline": z.string(),
          "description": z.string(),
          "monthlyPrice": z.string(),
          "monthlySuffix": z.string(),
          "features": z.array(z.object({
            "id": z.string(),
            "label": z.string(),
            "comingSoon": z.boolean().optional()
          })),
          "cta": z.string()
        })),
        "comparison": z.object({
          "eyebrow": z.string(),
          "title": z.string(),
          "features": z.array(z.object({
            "id": z.string(),
            "name": z.string(),
            "starter": z.boolean(),
            "growth": z.boolean(),
            "pro": z.boolean()
          }))
        }),
        "faq": z.object({
          "eyebrow": z.string(),
          "title": z.string(),
          "items": z.array(z.object({
            "id": z.string(),
            "question": z.string(),
            "answer": z.string()
          }))
        }),
        "cta": z.object({
          "title": z.string(),
          "description": z.string(),
          "primaryCta": z.string(),
          "secondaryCta": z.string()
        })
      })
    }),
    platform_pages: z.object({
      "features": z.object({
        "hero": z.object({
          "eyebrow": z.string(),
          "title": z.string(),
          "description": z.string(),
          "primaryCta": z.string(),
          "secondaryCta": z.string()
        }),
        "sections": z.array(z.object({
          "eyebrow": z.string(),
          "title": z.string(),
          "description": z.string(),
          "items": z.array(z.object({
            "label": z.string(),
            "id": z.string()
          })),
          "id": z.string()
        })),
        "summary": z.object({
          "title": z.string(),
          "items": z.array(z.object({
            "label": z.string(),
            "id": z.string()
          }))
        }),
        "cta": z.object({
          "title": z.string(),
          "description": z.string(),
          "primaryCta": z.string(),
          "secondaryCta": z.string()
        })
      }),
      "solutions": z.object({
        "hero": z.object({
          "eyebrow": z.string(),
          "title": z.string(),
          "description": z.string(),
          "primaryCta": z.string(),
          "secondaryCta": z.string()
        }),
        "missedCalls": z.object({
          "eyebrow": z.string(),
          "title": z.string(),
          "description": z.string(),
          "cta": z.string(),
          "flow": z.array(z.object({
            "label": z.string(),
            "id": z.string()
          }))
        }),
        "aiConversations": z.object({
          "eyebrow": z.string(),
          "title": z.string(),
          "description": z.string(),
          "controlNote": z.string(),
          "items": z.array(z.object({
            "label": z.string(),
            "id": z.string()
          }))
        }),
        "leadCapture": z.object({
          "eyebrow": z.string(),
          "title": z.string(),
          "description": z.string(),
          "table": z.object({
            "headers": z.array(z.object({
              "label": z.string(),
              "id": z.string()
            })),
            "row": z.object({
              "customer": z.string(),
              "service": z.string(),
              "address": z.string(),
              "urgency": z.string(),
              "status": z.string()
            })
          }),
          "followUps": z.object({
            "eyebrow": z.string(),
            "title": z.string(),
            "description": z.string(),
            "items": z.array(z.object({
              "label": z.string(),
              "id": z.string()
            }))
          }),
          "unified": z.object({
            "eyebrow": z.string(),
            "title": z.string(),
            "description": z.string(),
            "steps": z.array(z.object({
              "label": z.string(),
              "id": z.string()
            }))
          }),
          "industries": z.object({
            "eyebrow": z.string(),
            "title": z.string(),
            "items": z.array(z.object({
              "title": z.string(),
              "description": z.string(),
              "id": z.string()
            }))
          }),
          "cta": z.object({
            "title": z.string(),
            "description": z.string(),
            "primaryCta": z.string(),
            "secondaryCta": z.string()
          })
        })
      }),
      "mode": z.string()
    }),
    how_platform_works: z.object({
      "hero": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string(),
        "flow": z.array(z.object({
          "label": z.string(),
          "id": z.string()
        }))
      }),
      "stepOne": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string(),
        "callLabel": z.string(),
        "customerLabel": z.string(),
        "customerMessage": z.string()
      }),
      "stepTwo": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string(),
        "messages": z.array(z.object({
          "sender": z.string(),
          "text": z.string(),
          "id": z.string()
        }))
      }),
      "stepThree": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string(),
        "leadLabel": z.string(),
        "lead": z.object({
          "customer": z.string(),
          "phone": z.string(),
          "address": z.string(),
          "service": z.string(),
          "priority": z.string()
        }),
        "items": z.array(z.object({
          "label": z.string(),
          "id": z.string()
        }))
      }),
      "stepFour": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string(),
        "headers": z.array(z.object({
          "label": z.string(),
          "id": z.string()
        })),
        "rows": z.array(z.object({
          "customer": z.string(),
          "service": z.string(),
          "status": z.string(),
          "id": z.string()
        }))
      }),
      "stepFive": z.object({
        "eyebrow": z.string(),
        "title": z.string(),
        "description": z.string(),
        "controlNote": z.string(),
        "humanTitle": z.string(),
        "humanText": z.string()
      }),
      "cta": z.object({
        "title": z.string(),
        "description": z.string(),
        "primary": z.string(),
        "secondary": z.string()
      })
    }),
    marketing: z.object({
      "hero": z.object({
        "eyebrow": z.string(),
        "headline": z.string(),
        "body": z.string(),
        "cta": z.string()
      }),
      "whatComesNext": z.object({
        "heading": z.string(),
        "body": z.string(),
        "disclaimer": z.string(),
        "features": z.array(z.object({
          "id": z.string(),
          "label": z.string(),
          "detail": z.string()
        }))
      }),
      "connectScreen": z.object({
        "heading": z.string(),
        "body": z.string(),
        "cta": z.string(),
        "disclaimer": z.string(),
        "urlPlaceholder": z.string()
      }),
      "uploadFallback": z.object({
        "heading": z.string(),
        "body": z.string(),
        "cta": z.string(),
        "orDivider": z.string(),
        "tryAgainCta": z.string()
      }),
      "loadingSteps": z.array(z.object({
        "id": z.string(),
        "text": z.string()
      })),
      "loadingSubtext": z.string(),
      "profileHeader": z.object({
        "title": z.string(),
        "reanalyseLabel": z.string(),
        "reviewBadge": z.string(),
        "sectionHeading": z.string(),
        "sectionBody": z.string(),
        "reviewStatus": z.string(),
        "confirmedStatus": z.string()
      }),
      "sections": z.object({
        "overview": z.string(),
        "servicesProducts": z.string(),
        "customers": z.string(),
        "brand": z.string(),
        "marketing": z.string()
      }),
      "fields": z.object({
        "businessName": z.string(),
        "location": z.string(),
        "contactPhone": z.string(),
        "contactEmail": z.string(),
        "businessHours": z.string(),
        "website": z.string(),
        "businessDescription": z.string(),
        "services": z.string(),
        "products": z.string(),
        "pricing": z.string(),
        "targetCustomers": z.string(),
        "customerNeeds": z.string(),
        "brandTone": z.string(),
        "brandColors": z.string(),
        "brandDescription": z.string(),
        "logoUrl": z.string(),
        "socialLinks": z.string(),
        "keySellingPoints": z.string(),
        "promotions": z.string(),
        "faq": z.string(),
        "importantNotes": z.string()
      }),
      "saveBar": z.object({
        "savedMessage": z.string(),
        "savedSubtext": z.string(),
        "pendingMessage": z.string(),
        "saveCta": z.string(),
        "savingLabel": z.string()
      })
    })
  },
  data: {
    pricing_rates: z.array(z.object({
      "plan": z.string(),
      "monthlyPrice": z.string(),
      "monthlySuffix": z.string(),
      "yearlyMonthlyPrice": z.string(),
      "yearlyMonthlySuffix": z.string(),
      "yearlyPrice": z.string(),
      "savingsLabel": z.string(),
      "id": z.string()
    })),
    pricing_notes: z.array(z.object({
      "text": z.string(),
      "id": z.string()
    })),
    homepage_seo: z.array(z.object({
      "label": z.string(),
      "text": z.string(),
      "id": z.string()
    }))
  }
};
export type Schemas = typeof schemas;