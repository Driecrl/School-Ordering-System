# QCU Canteen Presentation Scope

The goal is to present the proposed ordering experience, not deploy a production system.

## Demo flow

- Choose student or staff sign-in and enter sample credentials.
- Complete a simulated first-time PIN change.
- Use the Switch to staff/student button to move between demo roles without signing in again; sample orders stay available during the presentation.
- Students browse a sample menu, build a cart, and place a pickup order.
- Staff view the sample order and move it through Received, Preparing, and Ready for pickup.
- When the student signs in after staff marks the order ready, the demo shows a pop-up and a ready message on the student's order card.

## Presentation constraints

- The standalone HTML demo uses in-memory sample data and needs no backend or database setup.
- PIN changes and orders reset when the page reloads.
- No real student/staff accounts, online payments, delivery, or live inventory are part of this presentation demo.
