export {
  IRREVERSIBLE_OFFICES,
  MUTATING_OFFICES,
  OFFICE_SPECS,
  officeRegistry,
} from "./registry.js";

export { fixtureTickets, recordsSystem, type Ticket } from "./systems/records.js";
export {
  GitHubRecordsError,
  githubRecordsSystem,
  type GitHubRecordsOptions,
} from "./systems/github-records.js";
export { exchequerSystem, fixtureCharges, type Charge } from "./systems/exchequer.js";
export { createOutbox, postHouseSystem, type Outbox, type SentMail } from "./systems/post-house.js";
export { mailpitSystem, type MailpitOptions } from "./systems/mailpit.js";
export {
  encodeHeader,
  renderMessage,
  replyCode,
  sendMail,
  stuffBody,
  type SmtpMessage,
  type SmtpOptions,
} from "./systems/smtp.js";
export {
  NotFoundError,
  assertMinorUnits,
  requireString,
  type OfficeHandler,
  type SystemDefinition,
} from "./systems/types.js";

export { stripeSystem, StripeError, type StripeOptions } from "./systems/stripe.js";
