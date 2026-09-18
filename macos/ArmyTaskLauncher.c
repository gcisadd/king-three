#include <fcntl.h>
#include <limits.h>
#include <mach-o/dyld.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

extern char **environ;

int main(void) {
  char executable_path[PATH_MAX];
  uint32_t executable_path_size = sizeof(executable_path);

  if (_NSGetExecutablePath(
        executable_path,
        &executable_path_size
      ) != 0) {
    return 1;
  }

  char *last_slash = strrchr(executable_path, '/');

  if (last_slash == NULL) {
    return 1;
  }

  *last_slash = '\0';

  char app_bundle_path[PATH_MAX];
  snprintf(
    app_bundle_path,
    sizeof(app_bundle_path),
    "%s/../..",
    executable_path
  );

  char resolved_app_bundle_path[PATH_MAX];

  if (realpath(
        app_bundle_path,
        resolved_app_bundle_path
      ) == NULL) {
    return 1;
  }

  char data_directory[PATH_MAX];
  snprintf(
    data_directory,
    sizeof(data_directory),
    "%s",
    resolved_app_bundle_path
  );

  last_slash = strrchr(data_directory, '/');

  if (last_slash == NULL) {
    return 1;
  }

  *last_slash = '\0';

  char binary_path[PATH_MAX];
  snprintf(
    binary_path,
    sizeof(binary_path),
    "%s/Contents/Resources/army-task-bin",
    resolved_app_bundle_path
  );

  char launch_log_path[PATH_MAX];
  snprintf(
    launch_log_path,
    sizeof(launch_log_path),
    "%s/ArmyTask-launch.log",
    data_directory
  );

  if (setenv(
        "ARMY_TASK_DATA_DIR",
        data_directory,
        1
      ) != 0) {
    return 1;
  }

  int launch_log_fd = open(
    launch_log_path,
    O_WRONLY | O_CREAT | O_APPEND,
    0644
  );

  if (launch_log_fd < 0) {
    return 1;
  }

  posix_spawn_file_actions_t file_actions;
  posix_spawn_file_actions_init(&file_actions);
  posix_spawn_file_actions_adddup2(
    &file_actions,
    launch_log_fd,
    STDOUT_FILENO
  );
  posix_spawn_file_actions_adddup2(
    &file_actions,
    launch_log_fd,
    STDERR_FILENO
  );
  posix_spawn_file_actions_addclose(
    &file_actions,
    launch_log_fd
  );

  char *child_argv[] = { binary_path, NULL };
  pid_t child_pid;
  int spawn_result = posix_spawn(
    &child_pid,
    binary_path,
    &file_actions,
    NULL,
    child_argv,
    environ
  );

  posix_spawn_file_actions_destroy(&file_actions);
  close(launch_log_fd);

  return spawn_result == 0 ? 0 : 1;
}
