import logging

from flask import Flask, render_template, request
from flask_babel import Babel
from flask_bootstrap import Bootstrap

from config import LOG_NAME

logger = logging.getLogger('werkzeug')
logger.setLevel(logging.ERROR)
logger = logging.getLogger(LOG_NAME)
logger.setLevel(logging.DEBUG)

app = Flask(__name__)
app.config.from_object('config')
app.config.from_pyfile('config.py')

app.secret_key = 'dev'

babel = Babel(app)
bootstrap = Bootstrap(app)


@babel.localeselector
def get_locale():
    return {'zh_CN': 'zh_Hans_CN', 'en': 'en'}.get(request.accept_languages.best_match(['zh_CN', 'en']))


@app.route('/', methods = ['GET', 'POST'])
def index():
    return render_template('index.html')


@app.route('/android', methods = ['GET', 'POST'])
def android():
    return render_template('android.html', locale = get_locale())


@app.route('/history', methods = ['GET', 'POST'])
def history():
    return render_template('history.html')


if __name__ == '__main__':
    from server import init_app

    socketio = init_app(app)
    socketio.run(app, port = 5500)
