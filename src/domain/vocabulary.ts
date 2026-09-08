/**
 * Plain names for the values routing and OpenStreetMap use among themselves.
 *
 * "trunk", "service_other" and "paved_smooth" are precise and mean nothing to
 * anyone reading a route. These say the same thing in the words a person would
 * use, and anything unrecognised falls back to the raw value tidied up rather
 * than to a guess — an unknown code is better shown than mislabelled.
 */

const ROAD_CLASS: Record<string, string> = {
  motorway: "Motorway",
  motorway_link: "Motorway slip road",
  trunk: "Major road",
  trunk_link: "Major road slip road",
  primary: "Main road",
  primary_link: "Main road slip road",
  secondary: "Secondary road",
  tertiary: "Local through road",
  unclassified: "Minor road",
  residential: "Residential street",
  service_other: "Service road",
  living_street: "Living street",
  track: "Track",
  footway: "Footway",
  cycleway: "Cycleway",
  path: "Path",
  pedestrian: "Pedestrian street",
  steps: "Steps",
};

const USE: Record<string, string> = {
  road: "Road",
  ramp: "Slip road",
  turn_channel: "Turning lane",
  track: "Track",
  driveway: "Driveway",
  alley: "Alley",
  parking_aisle: "Car park aisle",
  emergency_access: "Emergency access",
  drive_through: "Drive-through",
  culdesac: "Dead end",
  cycleway: "Cycleway",
  mountain_bike: "Mountain bike trail",
  sidewalk: "Pavement",
  footway: "Footway",
  steps: "Steps",
  path: "Path",
  pedestrian: "Pedestrian street",
  pedestrian_crossing: "Crossing",
  bridleway: "Bridleway",
  living_street: "Living street",
  service_road: "Service road",
  construction: "Under construction",
  elevator: "Lift",
  escalator: "Escalator",
  ferry: "Ferry",
  "rail-ferry": "Rail ferry",
  rail: "Railway",
  bus: "Bus route",
  egress_connection: "Station exit",
  platform_connection: "Platform link",
  transit_connection: "Transit link",
  other: "Other",
};

const SURFACE: Record<string, string> = {
  paved_smooth: "Smooth paved",
  paved: "Paved",
  paved_rough: "Rough paved",
  asphalt: "Asphalt",
  concrete: "Concrete",
  paving_stones: "Paving stones",
  compacted: "Compacted",
  fine_gravel: "Fine gravel",
  gravel: "Gravel",
  dirt: "Dirt",
  ground: "Bare ground",
  grass: "Grass",
  sand: "Sand",
  mud: "Mud",
  path: "Unsurfaced path",
  impassable: "Impassable",
};

const TRAVEL_MODE: Record<string, string> = {
  drive: "Driving",
  pedestrian: "On foot",
  bicycle: "Cycling",
  transit: "Public transport",
};

const TRAVEL_TYPE: Record<string, string> = {
  foot: "Walking",
  wheelchair: "Wheelchair",
  segway: "Segway",
  road: "Road bike",
  cross: "Cyclocross",
  hybrid: "Hybrid bike",
  mountain: "Mountain bike",
  car: "Car",
  motorcycle: "Motorcycle",
  bus: "Bus",
  tractor_trailer: "Lorry",
};

const SIDEWALK: Record<string, string> = {
  left: "On the left",
  right: "On the right",
  both: "Both sides",
  none: "None recorded",
};

const CYCLE_LANE: Record<string, string> = {
  none: "None recorded",
  shared: "Shared with traffic",
  dedicated: "Dedicated lane",
  separated: "Separated track",
};

/** An unrecognised code, made as readable as it can be without inventing meaning. */
function tidied(value: string): string {
  const words = value.replaceAll("_", " ").replaceAll("-", " ").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : value;
}

function lookup(table: Record<string, string>, value?: string): string | undefined {
  if (!value) return undefined;
  return table[value.toLowerCase()] ?? tidied(value);
}

export const roadClassName = (value?: string) => lookup(ROAD_CLASS, value);
export const useName = (value?: string) => lookup(USE, value);
export const surfaceName = (value?: string) => lookup(SURFACE, value);
export const travelModeName = (value?: string) => lookup(TRAVEL_MODE, value);
export const travelTypeName = (value?: string) => lookup(TRAVEL_TYPE, value);
export const sidewalkName = (value?: string) => lookup(SIDEWALK, value);
export const cycleLaneName = (value?: string) => lookup(CYCLE_LANE, value);
