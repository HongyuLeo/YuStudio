import React from 'react';
import {Composition, registerRoot} from 'remotion';
import {CinematicGlass, type CompositionProps} from './CinematicGlass';
import {dimensions, newProject} from '../project/model';
import {totalFrames} from '../timeline';
const project = newProject();
function Root() {
  return <>{(['landscape', 'portrait'] as const).map(orientation => <Composition
    key={orientation} id={orientation === 'landscape' ? 'Landscape' : 'Portrait'} component={CinematicGlass}
    width={orientation === 'landscape' ? 1920 : 1080} height={orientation === 'landscape' ? 1080 : 1920} fps={30} durationInFrames={1}
    defaultProps={{project, orientation}}
    calculateMetadata={({props}) => ({...dimensions(props.project, props.orientation), fps: props.project.fps, durationInFrames: totalFrames(props.project)})}
  />)}</>;
}
registerRoot(Root);
