# Portable Logger (works in bash >=3.2 and zsh)

# Default configuration
LOGGER_LEVEL=${LOGGER_LEVEL:-"INFO"}
LOGGER_FORMAT=${LOGGER_FORMAT:-"[%timestamp%] [%level%] [%cwd%] [%filename%] %message%"}
LOGGER_DATE_FORMAT=${LOGGER_DATE_FORMAT:-"%Y-%m-%d %H:%M:%S"}
LOGGER_COLORS=${LOGGER_COLORS:-true}

# Colors
LOGGER_COLOR_DEBUG="\033[0;36m"
LOGGER_COLOR_INFO="\033[0;32m"
LOGGER_COLOR_WARNING="\033[0;33m"
LOGGER_COLOR_ERROR="\033[0;31m"
LOGGER_COLOR_EXCEPTION="\033[0;35m"
LOGGER_COLOR_RESET="\033[0m"

# Levels
get_logger_level_num() {
  case "$LOGGER_LEVEL" in
    DEBUG) echo 0 ;;
    INFO) echo 1 ;;
    WARNING) echo 2 ;;
    ERROR) echo 3 ;;
    EXCEPTION) echo 4 ;;
    *) echo 1 ;;
  esac
}

should_log() {
  local level="$1"
  local current_level_num=$(get_logger_level_num)
  local message_level_num
  case "$level" in
    DEBUG) message_level_num=0 ;;
    INFO) message_level_num=1 ;;
    WARNING) message_level_num=2 ;;
    ERROR) message_level_num=3 ;;
    EXCEPTION) message_level_num=4 ;;
  esac
  [ "$message_level_num" -ge "$current_level_num" ]
}

# Filename (bash vs zsh)
get_logger_filename() {
  local filename
  if [ -n "$BASH_SOURCE" ]; then
    # In bash, BASH_SOURCE[2] gives the script that called the logger function.
    # If not present, use the script name ($0).
    filename="${BASH_SOURCE[2]:-$0}"
  elif [ -n "$ZSH_VERSION" ]; then
    # In zsh, %N is a special parameter expansion for the filename of the function definition.
    # In this context, it will give the script that called the function.
    filename="${(%):-%N}" 
  else
    filename="$0"
  fi
  echo "$(basename "$filename")"
}

# Cross-shell string replacement using sed
replace_placeholders() {
  local str="$1" level="$2" message="$3" timestamp="$4" cwd="$5" filename="$6"

  # Use sed for portable and reliable string substitution
  local replaced
  replaced=$(echo "$str" | sed \
    -e "s|%timestamp%|$timestamp|g" \
    -e "s|%level%|$level|g" \
    -e "s|%cwd%|$cwd|g" \
    -e "s|%filename%|$filename|g" \
    -e "s|%message%|$message|g")
  
  echo "$replaced"
}

format_log_message() {
  local level="$1" message="$2"
  local timestamp cwd filename formatted

  timestamp=$(date +"$LOGGER_DATE_FORMAT")
  cwd="$PWD"
  filename=$(get_logger_filename)

  formatted=$(replace_placeholders "$LOGGER_FORMAT" "$level" "$message" "$timestamp" "$cwd" "$filename")

  if [ "$LOGGER_COLORS" = true ]; then
    local color_var="LOGGER_COLOR_${level}"
    local color
    # Use indirect parameter expansion for portability
    # Zsh: setopt KSH_ARRAYS; eval 'color=${'$color_var'}'
    # Bash: eval "color=\$$color_var"
    eval "color=\$$color_var"
    formatted="${color}${formatted}${LOGGER_COLOR_RESET}"
  fi

  # echo with -e to interpret escape sequences (like colors)
  echo -e "$formatted"
}

log_debug()      { should_log "DEBUG"     && format_log_message "DEBUG" "$*"; }
log_info()       { should_log "INFO"      && format_log_message "INFO" "$*"; }
log_warning()    { should_log "WARNING"   && format_log_message "WARNING" "$*"; }
log_error()      { should_log "ERROR"     && format_log_message "ERROR" "$*"; }
log_exception()  { should_log "EXCEPTION" && format_log_message "EXCEPTION" "$*"; }
