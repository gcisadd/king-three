#import <Cocoa/Cocoa.h>
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

static int startTask(void) {
  char executablePath[PATH_MAX];
  uint32_t executablePathSize = sizeof(executablePath);

  if (_NSGetExecutablePath(
        executablePath,
        &executablePathSize
      ) != 0) {
    return 1;
  }

  char *lastSlash = strrchr(executablePath, '/');

  if (lastSlash == NULL) {
    return 1;
  }

  *lastSlash = '\0';

  char appBundlePath[PATH_MAX];
  snprintf(
    appBundlePath,
    sizeof(appBundlePath),
    "%s/../..",
    executablePath
  );

  char resolvedAppBundlePath[PATH_MAX];

  if (realpath(
        appBundlePath,
        resolvedAppBundlePath
      ) == NULL) {
    return 1;
  }

  char dataDirectory[PATH_MAX];
  snprintf(
    dataDirectory,
    sizeof(dataDirectory),
    "%s",
    resolvedAppBundlePath
  );

  lastSlash = strrchr(dataDirectory, '/');

  if (lastSlash == NULL) {
    return 1;
  }

  *lastSlash = '\0';

  char binaryPath[PATH_MAX];
  snprintf(
    binaryPath,
    sizeof(binaryPath),
    "%s/Contents/Resources/army-task-bin",
    resolvedAppBundlePath
  );

  char launchLogPath[PATH_MAX];
  snprintf(
    launchLogPath,
    sizeof(launchLogPath),
    "%s/ArmyTask-launch.log",
    dataDirectory
  );

  if (setenv(
        "ARMY_TASK_DATA_DIR",
        dataDirectory,
        1
      ) != 0) {
    return 1;
  }

  int launchLogFd = open(
    launchLogPath,
    O_WRONLY | O_CREAT | O_APPEND,
    0644
  );

  if (launchLogFd < 0) {
    return 1;
  }

  posix_spawn_file_actions_t fileActions;
  posix_spawn_file_actions_init(&fileActions);
  posix_spawn_file_actions_adddup2(
    &fileActions,
    launchLogFd,
    STDOUT_FILENO
  );
  posix_spawn_file_actions_adddup2(
    &fileActions,
    launchLogFd,
    STDERR_FILENO
  );
  posix_spawn_file_actions_addclose(
    &fileActions,
    launchLogFd
  );

  char *childArgv[] = { binaryPath, NULL };
  pid_t childPid;
  int spawnResult = posix_spawn(
    &childPid,
    binaryPath,
    &fileActions,
    NULL,
    childArgv,
    environ
  );

  posix_spawn_file_actions_destroy(&fileActions);
  close(launchLogFd);

  return spawnResult == 0 ? 0 : 1;
}

int main(void) {
  @autoreleasepool {
    if (startTask() != 0) {
      return 1;
    }

    NSApplication *application = [NSApplication sharedApplication];
    [application setActivationPolicy:NSApplicationActivationPolicyAccessory];
    [application run];
  }

  return 0;
}
