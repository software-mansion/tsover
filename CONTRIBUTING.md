# Contributing

## Reporting Issues and Suggesting Features

If you encounter what you believe is a bug, or have a feature suggestion, please
[create an issue](https://github.com/software-mansion/tsover/issues/new).

## Development

To contribute by resolving an open issue or developing a new feature, please
adhere to the following workflow:

1. Fork this repository.
2. Create a new feature branch from the `main` branch.
3. Run the `pnpm test && pnpm check` to verify that the changes pass tests.
4. Stage your changes and commit them. We recommend following the
   [Conventional Commit Specification](https://www.conventionalcommits.org/en/v1.0.0/)
   for commit messages.
5. Submit the PR for review.

After your pull request is submitted, we will review it at as soon as possible.
We may suggest changes or request additional improvements, so please enable
[Allow edits from maintainers](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/creating-a-pull-request-from-a-fork)
on your PR.

## Release Checklist

1. Create new branches for each patch you want to release, basing them off of the existing `major.minor.x` branches, update version string in package.json, run `pnpm install`
2. Take the Continuous Release build and test the changes
   (optional)
3. Release from CI
4. Update [`CHANGELOG-tsover.md`](./CHANGELOG-tsover.md) and [`CHANGELOG-tsover-runtime.md`](./CHANGELOG-tsover-runtime.md)
