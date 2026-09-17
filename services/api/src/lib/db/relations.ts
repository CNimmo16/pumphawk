import { defineRelations } from "drizzle-orm";
import * as schema from "./schema";
export const relations = defineRelations(schema, (r) => ({
  user: {
    sessions: r.many.session(),
    accounts: r.many.account(),
    driver: r.one.driver({ from: r.user.id, to: r.driver.userId }),
    messages: r.many.smsMessage(),
  },
  session: {
    user: r.one.user({
      from: r.session.userId,
      to: r.user.id,
      optional: false,
    }),
  },
  account: {
    user: r.one.user({
      from: r.account.userId,
      to: r.user.id,
      optional: false,
    }),
  },
  driver: {
    user: r.one.user({ from: r.driver.userId, to: r.user.id, optional: false }),
  },
  trackedStation: {
    station: r.one.station({
      from: r.trackedStation.stationId,
      to: r.station.id,
      optional: false,
    }),
  },
  smsMessage: {
    user: r.one.user({ from: r.smsMessage.userId, to: r.user.id }),
  },
}));
