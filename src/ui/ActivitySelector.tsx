import { Bike, Footprints, PersonStanding } from "lucide-react";
import { ACTIVITY } from "../domain/activity-profiles";
import type { Activity } from "../domain/models";

export function ActivitySelector({
  value,
  onChange,
}: {
  value: Activity;
  onChange: (activity: Activity) => void;
}) {
  const icons = { run: PersonStanding, walk: Footprints, cycle: Bike };
  return (
    <div className="activity-selector" aria-label="Activity">
      {(Object.keys(ACTIVITY) as Activity[]).map((activity) => {
        const Icon = icons[activity];
        return (
          <button
            key={activity}
            className={value === activity ? "active" : ""}
            aria-pressed={value === activity}
            onClick={() => onChange(activity)}
          >
            <Icon size={18} />
            <span>{ACTIVITY[activity].label}</span>
          </button>
        );
      })}
    </div>
  );
}
