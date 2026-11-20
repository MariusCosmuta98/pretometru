import { createHashRouter } from 'react-router';
import { features } from './features';
import { buildRoutes } from './routes';

// Hash routing: GitHub Pages cannot rewrite unknown paths to index.html.
export const router = createHashRouter(buildRoutes(features));
