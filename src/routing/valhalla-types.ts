export type ValhallaLeg = {
  shape?: string;
  summary?: { length?: number; time?: number };
  elevation?: number[];
};
export type ValhallaTrip = {
  legs?: ValhallaLeg[];
  summary?: { length?: number; time?: number };
  status_message?: string;
};
export type ValhallaRouteResponse = {
  trip?: ValhallaTrip;
  alternates?: Array<{ trip?: ValhallaTrip }>;
  error?: string;
  error_code?: number;
};
export type ValhallaTraceResponse = {
  edges?: Array<Record<string, unknown>>;
  shape?: string;
  error?: string;
};
