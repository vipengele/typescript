#!/usr/bin/env bash
# Builds the sibling projects a project's cross-project dependencies (ADR-0009)
# link to, so their dist/ exists before the project itself installs and builds.
#
# Usage: build.sh <project>, run from the repository root.
#
# A package's owning project is the source/<project> directory its manifest sits
# under. A `dependencies` entry owned by another project is a cross-project
# dependency (ADR-0009); one owned by the same project is a workspace:* link
# and is left to that project's own build graph. The owning projects are
# collected transitively and built dependencies first, each running
# `pnpm --filter <pkg>... build` so the sibling's intra-project ordering stays
# its own.
set -euo pipefail

project="${1:?usage: build.sh <project>}"

if [[ ! -d "source/${project}" ]]; then
  echo "::error::No project directory source/${project}"
  exit 1
fi

shopt -s nullglob
manifests=(source/*/packages/*/package.json)
shopt -u nullglob

if ((${#manifests[@]} == 0)); then
  echo "no package manifests under source/; nothing to build"
  exit 0
fi

# One line per owning project to build, in build order: "<project>\t<pkg> <pkg>...".
if ! plan="$(jq -nr --arg target "$project" '
  [inputs | {
    project: (input_filename | split("/")[1]),
    name,
    deps: ((.dependencies // {}) | keys)
  }] as $manifests
  | ($manifests | map({(.name): .project}) | add // {}) as $owner

  | def cross($p):
      [$manifests[] | select(.project == $p) | .deps[]
       | select($owner[.] != null and $owner[.] != $p)
       | {pkg: ., owner: $owner[.]}] | unique;

    def closure:
      . as $set
      | ($set + [$set[] as $q | cross($q)[] | .owner] | unique) as $next
      | if $next == $set then $set else $next | closure end;

    def topo($deps):
      . as [$order, $remaining]
      | if ($remaining | length) == 0 then $order
        else
          [$remaining[] | select(. as $q | $deps[$q] - $order | length == 0)] as $ready
          | if ($ready | length) == 0
            then error("cross-project dependency cycle among: \($remaining | join(", "))")
            else [$order + $ready, $remaining - $ready] | topo($deps)
            end
        end;

  ([cross($target)[] | .owner] | unique | closure) as $discovered
  | if ($discovered | index($target)) != null
    then error("cross-project dependency cycle through \($target)")
    else . end
  | ($discovered | map({(.): ([cross(.)[] | .owner] | unique)}) | add // {}) as $deps
  | [[], $discovered] | topo($deps)
  | .[] as $q
  | [([$target] + $discovered)[] as $p | cross($p)[] | select(.owner == $q) | .pkg] | unique
  | "\($q)\t\(join(" "))"
' "${manifests[@]}")"; then
  echo "::error::Could not resolve the cross-project dependencies of ${project}"
  exit 1
fi

if [[ -z "$plan" ]]; then
  echo "${project} has no cross-project dependencies; nothing to build"
  exit 0
fi

echo "cross-project dependencies of ${project}, in build order:"
while IFS=$'\t' read -r owner pkgs; do
  echo "  ${owner}: ${pkgs}"
done <<< "$plan"

while IFS=$'\t' read -r owner pkgs; do
  read -ra names <<< "$pkgs"
  filters=()
  labels=()
  for name in "${names[@]}"; do
    filters+=(--filter "${name}...")
    labels+=("${owner}/${name}")
  done

  echo "::group::Building cross-project dependency ${labels[*]}"
  if ! (cd "source/${owner}" && pnpm install --frozen-lockfile && pnpm "${filters[@]}" build); then
    echo "::endgroup::"
    for label in "${labels[@]}"; do
      echo "::error title=Cross-project dependency build failed::Failed building cross-project dependency ${label} (required by ${project})"
    done
    exit 1
  fi
  echo "::endgroup::"
done <<< "$plan"
