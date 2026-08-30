import { useReducer, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { PlannerMap } from '@/components/planner-map';
import { PlannerSheet } from '@/components/planner-sheet';
import {
  initialPlannerState,
  plannerReducer,
  selectWaypoint,
  updatePlanFromMapPress,
} from '@/state/planner';

export default function PlannerScreen() {
  const [state, dispatch] = useReducer(plannerReducer, initialPlannerState);
  const [notice, setNotice] = useState(
    'Tap the map to begin. Routing requests are the next migration slice.',
  );

  return (
    <View style={styles.root}>
      <PlannerMap
        camera={state.camera}
        waypoints={state.waypoints}
        onMapPress={(coordinate) =>
          dispatch({ type: 'replace', state: updatePlanFromMapPress(state, coordinate) })
        }
        onWaypointPress={(id) =>
          dispatch({ type: 'replace', state: selectWaypoint(state, id) })
        }
      />

      <View pointerEvents="none" style={styles.brandPill}>
        <Text style={styles.brand}>OPENLOOPER</Text>
        <Text style={styles.brandSub}>Native migration preview</Text>
      </View>

      <PlannerSheet
        state={state}
        notice={notice}
        dispatch={dispatch}
        onSearch={(query) =>
          setNotice(
            query.trim()
              ? `Search for “${query.trim()}” will move into the shared service adapter next.`
              : 'Enter a place before searching.',
          )
        }
        onRoute={() =>
          setNotice(
            state.mode === 'loop'
              ? 'Loop generation is ready to be connected to the shared Valhalla client.'
              : 'Add both endpoints to connect this plan to Valhalla.',
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#e9eee8',
  },
  brandPill: {
    position: 'absolute',
    top: 18,
    right: 18,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: 'rgba(250,251,247,0.94)',
    shadowColor: '#172019',
    shadowOpacity: 0.14,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
  },
  brand: {
    color: '#172019',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  brandSub: {
    color: '#68736b',
    fontSize: 10,
    marginTop: 2,
  },
});
