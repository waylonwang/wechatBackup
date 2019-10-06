import atexit
import importlib
import logging
import signal

from flask_babel import gettext as _
from flask_socketio import SocketIO, Namespace, leave_room

from config import LOG_NAME
from .android import AndroidDevice, DbPullRunner, DbDecryptRunner,\
    ResPullRunner, DBPullRunnerInitError, DbDecryptRunnerInitError,\
    ResPullRunnerInitError
from .task import TaskDaemon, TaskRunner, HeartbeatRunner, OnceRunner,\
    HeartbeatInitError, OnceInitError

_daemon = None

logger = logging.getLogger(LOG_NAME)


class GeneralNamespace(Namespace):

    def on_join(self, data):
        self.enter_room(data['sid'], data['channel'])

    def on_leave(self, data):
        leave_room(data['sid'], data['channel'])

    def on_exec_command(self, *args):
        """执行即时命令

        命令参数按以下格式提交
        {
            name: #[必选]名称
            channel: #[必选]信道
            command: #[必选]命令名
            params: #[可选]参数
        }

        命令添加结果按以下格式返回
        (
            command, #命令名
            name, #任务名
            success, #是否成功
            data, #业务数据
            message, #提示消息
        )

        :param args: 命令参数
        :return: 命令执行结果
        """
        try:
            data = args[0]
            assert data.get("name", None)
            assert data.get("channel", None)
            assert data.get("command", None)
            channel_device = importlib.import_module(
                f'server.{data["channel"]}.device')
            client = getattr(channel_device, '_client')
            command = getattr(client, f'cmd_{data["command"]}')
            result = command(data["name"], **data.get('params', {}))
            # noinspection PyTypeChecker
            return (data['command'],
                    data.get('name', None)) + result
        except (AssertionError, ModuleNotFoundError):
            return (data['command'],
                    data.get('name', None),
                    False, False, _('Command init error'))

    def on_add_task(self, *args):
        """添加后台任务

        任务参数按以下格式提交
        {
            name: #[必选]名称
            channel: #[必选]信道
            category: #[必选]类别
            params: #[可选]参数
        }

        任务添加结果按以下格式返回
        (
            command, #命令名
            name, #任务名
            success, #是否成功
            data, #业务数据
            message, #提示消息
        )

        :param args: 任务参数
        :return: 任务添加结果
        """
        try:
            data = args[0]
            assert data.get("name", None)
            assert data.get("channel", None)
            assert data.get("category", None)
            channel_task = importlib.import_module(
                f'server.{data["channel"]}.task')
            categories = getattr(channel_task, 'task_categories')
            channel_device = importlib.import_module(
                f'server.{data["channel"]}.device')
            client = getattr(channel_device, '_client')
            runner = categories.get(data["category"], None)
            assert runner
            params = data.get("params", None)
            params["device"] = client
            result = _daemon.add_task(runner, data["name"],
                                      params = params,
                                      callback = self.task_response)
            return (data['category'],
                    data.get('name', None),
                    result, None, None)
        except (AssertionError, ModuleNotFoundError):
            return (data['category'],
                    data.get('name', None),
                    False, None, _('Task init error'))

    def on_kill_task(self, *args):
        """杀死后台任务

        :param args: 任务参数
        :return: 任务杀死结果
        """
        try:
            data = args[0]
            assert data.get("name", None)
            assert data.get("channel", None)
            result = _daemon.kill_task(data["name"])
            return ('Kill task',
                    data["name"],
                    result, None, None)
        except AssertionError:
            return ('Kill task',
                    data.get('name', None),
                    False, None, _('Kill task error'))

    def task_response(self, channel, data):
        """
        任务执行回调

        任务执行过程或结束时返回给请求方的数据，数据按以下格式返回
        (
            command, #命令名
            name, #任务名
            success, #是否成功
            data, #业务数据
            message, #提示消息
        )

        :param channel: 信道
        :param data: 返回数据
        :return: 无
        """
        self.emit('task_response',
                  data,
                  namespace = '/general',
                  room = channel)


def exit_running_daemon_by_atexit():
    logger.debug('exit by atexit')
    _daemon.exit()
    _daemon.join()


def exit_running_daemon_by_signal(signum, frame):
    logger.debug(f'exit by signal: {signum}')
    _daemon.exit()
    _daemon.join()


def init_app(app):
    _socketio = SocketIO(app)
    _socketio.on_namespace(GeneralNamespace('/general'))

    # 启动任务守护线程
    global _daemon
    _daemon = TaskDaemon()
    _daemon.setDaemon(True)
    _daemon.start()

    # 程序退出时退出任务守护线程
    atexit.register(exit_running_daemon_by_atexit)
    signal.signal(signal.SIGTERM, exit_running_daemon_by_signal)

    return _socketio


__version__ = '0.9.0'
__author__ = 'Waylon Wang'
__email__ = 'waylon@waylon.wang'
__all__ = (
    # task class
    'TaskDaemon',
    'TaskRunner',
    'HeartbeatRunner',
    'OnceRunner',
    'DbPullRunner',
    'DbDecryptRunner',
    'ResPullRunner',
    # socket class
    'GeneralNamespace',
    # device class
    'AndroidDevice',
    # errot class
    'HeartbeatInitError',
    'OnceInitError',
    'DBPullRunnerInitError',
    'DbDecryptRunnerInitError',
    'ResPullRunnerInitError',
)
