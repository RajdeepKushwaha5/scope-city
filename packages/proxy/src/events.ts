import type { DenialReason } from "@scope-city/scope";

/**
 * What the proxy tells the world about a call. These are the events the map
 * animates, so they are part of the contract rather than debug logging -- if
 * you rename one, a building stops lighting up.
 */
export type ProxyEvent =
  | {
      readonly type: "call.allowed";
      readonly missionId: string;
      readonly office: string;
      readonly district: string;
      readonly sequence: number;
      readonly at: number;
    }
  | {
      /**
       * The agent tried to leave the scope. This is the one the demo turns on:
       * no model was consulted, nothing was asked of a human, the call simply
       * stopped at the city limit.
       */
      readonly type: "call.out_of_scope";
      readonly missionId: string;
      readonly office: string;
      readonly district: string | null;
      readonly reason: DenialReason;
      readonly detail: string;
      readonly at: number;
    }
  | {
      readonly type: "call.countersign_required";
      readonly missionId: string;
      readonly office: string;
      readonly district: string;
      readonly fingerprint: string;
      readonly at: number;
    }
  | {
      /** Fields the upstream returned that the scope did not permit. */
      readonly type: "response.redacted";
      readonly missionId: string;
      readonly office: string;
      readonly redacted: readonly string[];
      readonly truncated: boolean;
      readonly at: number;
    }
  | {
      /** Instruction-shaped text arriving through a legitimate channel. */
      readonly type: "response.injection_detected";
      readonly missionId: string;
      readonly office: string;
      readonly samples: readonly string[];
      readonly at: number;
    }
  | {
      readonly type: "quota.consumed";
      readonly missionId: string;
      readonly office: string;
      readonly used: number;
      readonly ceiling: number | undefined;
      readonly at: number;
    }
  | {
      readonly type: "upstream.failed";
      readonly missionId: string;
      readonly office: string;
      readonly message: string;
      readonly at: number;
    };

export type EmitProxyEvent = (event: ProxyEvent) => void;
