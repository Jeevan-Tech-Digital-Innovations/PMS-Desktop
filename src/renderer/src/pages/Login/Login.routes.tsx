import type { RouteObject } from 'react-router-dom';

export const loginRoutes: RouteObject[] = [
  {
    index: true,
    lazy: async () => {
      const { default: Component } = await import('./Login/Login');
      return { Component };
    },
  },
];
