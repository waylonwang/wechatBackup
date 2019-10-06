import logging
import time
from urllib.parse import unquote as urldecode
from threading import Thread, Event

from flask_babel import gettext as _

from config import LOG_NAME

logger = logging.getLogger(LOG_NAME)


class TaskRunnerInitError(RuntimeError):
    pass


class TaskDaemon(Thread):
    """任务守护线程
    """

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self._exit = Event()  # 守护线程退出标识
        self._tasks = {}  # 所有任务列表
        self._tasks_running = []  # 在运行任务列表

    def run(self):
        logger.debug('daemon run start')
        while not self._exit.is_set():
            # 清理在运行任务列表中已结束的任务
            self._tasks_running[:] = [
                t for t in self._tasks_running if t]
            # 每个任务按加入的顺序执行
            for i in range(len(self._tasks_running)):
                task = self._tasks_running[i]
                # 如任务已被杀死则忽略
                if not task:
                    continue
                # 如是新加入的任务则启动任务
                if not task._started.is_set():
                    task.start()
                # 如任务没有存活则停止任务
                if not task.is_task_alive():
                    logger.debug('daemon run stop')
                    task.stop()
                # 如果任务已经停止则清理任务
                if task._stopped.is_set():
                    if task.is_kill_when_stop():
                        # 杀掉任务
                        self.kill_task(task.name)
                    else:
                        # 设置为待清理
                        self._tasks_running[i] = None
            # 每秒轮询
            time.sleep(1)
        logger.debug('daemon run finish')

    def exit(self):
        '''退出守护线程

        :return:
        '''
        logger.debug('daemon exit start')
        # 结束所有在运行的任务
        for task in self._tasks_running:
            task.stop()
        # 清空任务列表和在运行任务列表
        self._tasks = {}
        self._tasks_running = []
        # 设置退出标识
        self._exit.set()
        logger.debug('daemon exit finish')

    def add_task(self, class_, name, callback = None, params = None,
                 **kwargs):
        task = class_(name = name, callback = callback,
                      params = params, **kwargs)
        if self.has_task(name):
            return False
        self._tasks[name] = task
        self._tasks_running.append(task)
        return True

    def has_task(self, name):
        return name in self._tasks

    def kill_task(self, name):
        try:
            task = self._tasks.get(name, None)
            assert task
            if task.is_task_alive():
                task.stop()
            task.on_kill()
            if task in self._tasks_running:
                index = self._tasks_running.index(task)
                self._tasks_running[index] = None
            self._tasks.pop(name)
            return True
        except AssertionError:
            return True
        except Exception as e:
            return False

    def query_tasks(self):
        return [{'name': task.name,
                 'running': True if task in self._tasks_running else
                 False}
                for task in self._tasks]

    def has_task_running(self):
        return len(self._tasks_running) > 0

    def call(self, name, method, *args, **kwargs):
        task = self._tasks.get(name, None)
        if task:
            return getattr(task, method)(*args, **kwargs)

    def getattr(self, name, attribute):
        task = self._tasks.get(name, None)
        if task:
            return getattr(task, attribute)

    def setattr(self, name, attribute, value):
        task = self._tasks.get(name, None)
        if task:
            return setattr(task, attribute, value)


class TaskRunner(Thread):
    """任务运行器
    """

    def __init__(self, **kwargs):
        try:
            # 取出任务名称作为线程名称
            name = kwargs.get('name', None)
            assert name
            kwargs.pop('name')
            super().__init__(name = name, kwargs = kwargs)

            # 回调句柄
            self._callback = kwargs.get('callback', None)
            # 运行参数
            self._params = kwargs.get('params', None)
            if self._params:
                for k, v in self._params.items():
                    setattr(self, f'_{k}', v)
            # 线程控制成员
            self._stopped = Event()  # 线程停止标识
            self._stop_by_user = False  # 被用户终止标识
            self._stop_by_self = False  # 被任务自身终止标识
            self._stop_by_daemon = False  # 被守护线程终止标识
            self._run_times = 0  # 运行次数
        except AssertionError:
            raise TaskRunnerInitError()

    def run(self):
        # 前置运行，获得轮询间隔
        interval = self._on_before_runloop()
        interval = interval\
            if interval and (isinstance(interval, int)
                             or isinstance(interval, float)) else 0.1
        while not self._stopped.is_set():
            self._run_times = self._run_times + 1
            logger.debug(
                f"[{urldecode(self.name)}] run loop start ({self._run_times})")
            # 主体运行
            self._on_runloop()
            # 按间隔轮询
            time.sleep(interval)
            logger.debug(
                f"[{urldecode(self.name)}] run loop end ({self._run_times})")
        # 后置运行，用于清场
        self._on_after_runloop()

    def stop(self):
        try:
            logger.debug(f"[{urldecode(self.name)}] stop server start")
            self._on_before_stop()
            self._stopped.set()
            self._stop_by_user = True
            self._on_after_stop()
            logger.debug(f"[{urldecode(self.name)}] stop server end")
            return True, True, self._get_stop_success_message()
        except Exception:
            return False, False, self._get_stop_success_message()

    def is_task_alive(self):
        pass

    def is_kill_when_stop(self):
        pass

    def on_kill(self):
        pass

    def _on_before_runloop(self):
        return 0.1

    def _on_runloop(self):
        pass

    def _on_after_runloop(self):
        pass

    def _on_before_stop(self):
        pass

    def _on_after_stop(self):
        pass

    def _get_stop_success_message(self):
        return _('Task has stopped')

    def _get_stop_fail_message(self):
        return _('Task stop failed')


class HeartbeatInitError(RuntimeError):
    pass


class OnceInitError(RuntimeError):
    pass


class HeartbeatRunner(TaskRunner):
    """心跳运行器
    """

    def __init__(self, **kwargs):
        super().__init__(**kwargs)

        try:
            assert self._callback
            assert self._interval
            assert self._command
            from server.android.device import\
                _client  # todo change to current_client
            self._command_func = getattr(_client,
                                         f'cmd_{self._command}',
                                         None)
            self._alive_func = getattr(_client,
                                       f'alive_{self._command}',
                                       None)
            assert self._command_func

        except AssertionError:
            raise HeartbeatInitError()

    def _on_before_runloop(self):
        return self._interval

    def _on_runloop(self):
        if self._command_func:
            self._callback('android',
                           (self._command, self.name) +
                           self._command_func(self.name,
                                              **self._params))
        else:
            self._callback('android',
                           (self._command, self.name, False, False,
                            None))

    def _on_after_runloop(self):
        logger.debug(f'[{urldecode(self.name)}] after run loop')

    def is_task_alive(self):
        if self._alive_func:
            return self._alive_func(self.name, **self._params)
        else:
            return True

    def is_kill_when_stop(self):
        return True


class OnceRunner(TaskRunner):
    """一次性运行器
    """

    def __init__(self, **kwargs):
        super().__init__(**kwargs)

        try:
            assert self._callback
            assert self._command
            from server.android.device import\
                _client  # todo change to current_client
            self._command_func = getattr(_client,
                                         f'cmd_{self._command}',
                                         None)
            assert self._command_func

        except AssertionError:
            raise OnceInitError()

    def _on_runloop(self):
        self._callback('android',
                       (self._command, self.name) +
                       self._command_func(self.name,
                                          **self._params))

    def is_task_alive(self):
        return False

    def is_kill_when_stop(self):
        return True
