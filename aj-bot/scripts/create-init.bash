#!/usr/bin/env bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR"/logger.bash
# Create init in all subdirectories

create_init() {
  local dir_name="$1"
  local cur_dir
  cur_dir=$(pwd)
  cd "$dir_name" || exit
  touch __init__.py
  cd "$cur_dir" || exit
  log_info "Created init file in ${dir_name}"
}

create_init_subdirs() {
  local dir_name="$1"

  for dir in "$dir_name"/*; do
    [ -d "$dir" ] || continue
    create_init "$dir"
  done
}

create_init_subdirs "$@"
