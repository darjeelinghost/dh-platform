
# DarjeelingHost

### Driver Outsourcing Platform

**Version:** 1.0  
**Status:** Initial Development  
**Platform:** Web Application

---

## About

DarjeelingHost is a lightweight driver outsourcing platform designed to connect people and businesses requiring transport services with independent drivers who can fulfil those requirements.

The platform initially focuses on drivers and travel agents.

## User Categories

### 1. Poster
A person or business posting a trip outsourcing request.

Two types of Posters:
- Driver
- Travel Agent

### 2. Fulfiller
A registered driver who accepts and fulfils an outsourced trip.

A driver can act as both Poster and Fulfiller on different trips.

## Core Features – V1

- Driver registration
- Travel Agent registration
- Login and authentication
- User profile management
- Driver verification
- Travel Agent approval
- Trip outsourcing requests
- Request browsing
- Trip acceptance
- Basic user dashboard

## Account Approval

- Driver accounts require verification.
- Travel Agent accounts require Super Admin approval.
- New accounts remain pending until approved.
- Only authorised users receive operational access.

## Technology Stack

| Technology | Purpose |
|---|---|
| HTML | Structure |
| CSS | Design |
| JavaScript | Functionality |
| Firebase Authentication | User authentication |
| Cloud Firestore | Database |
| Firebase Security Rules | Data protection |
| Vercel | Hosting |
| GitHub | Source code management |

## Development Philosophy

DarjeelingHost V1 follows a lightweight development approach.

Principles:
- Keep the software simple.
- Minimise unnecessary features.
- Prioritise mobile compatibility.
- Use free infrastructure where possible.
- Maintain efficient database operations.
- Prioritise security and reliability.
- Avoid unnecessary dependencies.

## Pricing Policy

DarjeelingHost V1 is completely free.

- No subscription fees.
- No registration fees.
- No platform commission.
- No paid memberships.

Future commercial features may be considered in subsequent versions.

## Future Development

Potential improvements for V2:
- Advanced trip management
- Notifications
- Improved driver verification
- Booking coordination tools
- Additional administrative features

These features are not part of the initial V1 scope.

## Project Structure

Initial planned structure:

```text
dh-platform/
│
├── index.html
├── README.md
├── firebase.js
├── firestore.rules
│
├── css/
│   └── style.css
│
└── js/
    └── app.js
```

## Security

- Firebase Authentication manages user identity.
- Firestore Security Rules enforce access permissions.
- Administrative privileges must be protected.
- Users cannot approve their own accounts.
- Super Admin privileges are restricted to the platform owner.
- Sensitive server credentials must never be exposed in frontend code.

## Licence

Proprietary project.

Copyright © DarjeelingHost.
All rights reserved.

