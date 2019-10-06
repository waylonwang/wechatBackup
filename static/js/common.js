// 全局常量及变量定义
var gt = new Gettext({domain: "wechatBackup"});
var _ = function (msgid) {
    return gt.gettext(msgid);
};
var ngettext = function (msgid, msgid_plural, n) {
    return gt.ngettext(msgid, msgid_plural, n);
};

const OutputType = {
    STDOUT: 0,
    ERROR: 1,
    STATUS: 2,
    SUCCESS: 3,
};

var socketio = null;

/**
 * 连接服务器
 */
function connectServer() {
    var fsm = getCurrentDeviceFSM();
    socketio = io.connect("http://" + document.domain + ":" + location.port + "/general");
    socketio.on("connect", function () {
        if (fsm.can("connect-server"))
            fsm.connectServer(socketio);
    }).on("disconnect", function () {
        if (fsm.can("disconnect-server"))
            fsm.disconnectServer(socketio);
    });
}

/**
 * 断开服务器
 */
function disconnectServer() {
    if (isServerConnected(false))
        var fsm = getCurrentDeviceFSM();
        fsm.onBeforeCloseServerConnection();
        socketio.disconnect();
}

/**
 * 重连服务器
 */
function reconnectServer() {
    if (!isServerConnected(false))
        socketio.connect();
}

/**
 * 获取当前设备的状态机
 * @returns {*}
 */
function getCurrentDeviceFSM() {
    return fsmDevice;
}

/**
 * 判断是否服务器已连接
 * @param isSendOutput 未连接时是否发送输出消息
 * @returns {boolean} 是否服务器已连接
 */
function isServerConnected(isSendOutput) {
    if (socketio.connected) {
        return true;
    } else {
        if (isSendOutput)
            sendOutput(_("The server connection has been disconnected, please reconnect"), OutputType.ERROR);
        return false;
    }
}

$(function () {
    // 通讯断开
    $("#btn_disconnect").on("click", function () {
        disconnectServer();
    });
    // 通讯重连
    $("#btn_reconnect").on("click", function () {
        reconnectServer();
    });
    // 通讯连线
    connectServer();
});