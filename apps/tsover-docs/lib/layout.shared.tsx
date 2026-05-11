import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { Logo } from '@/components/logo';

// fill this with your actual GitHub info, for example:
export const gitConfig = {
  user: 'software-mansion',
  repo: 'tsover',
  branch: 'main',
};

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <Logo className="h-6 w-auto" />,
      url: 'https://tsover.swmansion.com/',
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
