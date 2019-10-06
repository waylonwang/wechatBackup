// 全局常量及变量定义
const SHOW_FOOT_INFO = false;

/**
 * 清除项目浏览区的内容
 */
function clearProjectBrowserContent() {
    $(".project-browser").empty();
}

/**
 * 更新项目浏览区的显示状态
 * @param switchShow 是否切换为显示
 */
function updateProjectBrowserDisplay(switchShow) {
    if (switchShow && !$(".project-browser").parent().hasClass("w-fill")) {
        $(".project-browser")
            .parent()
            .animate({width: $(".controller-contents-master").width()},
                {
                    complete: function () {
                        $(this).addClass("w-fill");
                    },
                });
    } else if (!switchShow && $(".project-browser").parent().hasClass("w-fill")) {
        $(".project-browser")
            .parent()
            .removeClass("w-fill")
            .animate({width: "0px"});
    }
}

/**
 * 生成项目名称
 * @returns {string}
 */
function generateProjectName() {
    var projectDate = new Date(+new Date()
        - (new Date().getTimezoneOffset() / 60 * 3600 * 1000));
    var projectName = projectDate.toJSON().substr(0, 19).replace(/[-|:|T]/g, "")
        + "_" + Math.random().toString(36).slice(-4);
    return projectName;
}

/**
 * 发送消息到日志输出框
 * @param message 输出消息
 * @param type 输出类型
 */
function sendOutput(message, type) { // 命令执行反馈
    switch (type) {
        case OutputType.ERROR:
            message = $("<li class=\"output-error\"></li>").text(message);
            break;
            ``;
        case OutputType.STATUS:
            message = $("<li class=\"output-status\"></li>").text(message);
            break;
        case OutputType.SUCCESS:
            message = $("<li class=\"output-success\"></li>").text(message);
            break;
        default:
            message = $("<li class=\"output-stdout\"></li>").text(message);
    }
    $(".output ul").append(message);
    $(".output-frame").scrollTop($(".output-frame").prop("scrollHeight"));
}

/**
 * 发送fsm生命周期到页脚信息框
 * @param lifecycle fsm生命周期
 */
function sendFootInfo(lifecycle) {
    if (SHOW_FOOT_INFO) {
        $("#fsm_state").empty();
        $("#fsm_state").append(("<span class='foot-transition'>{0}</span>" +
            "<span class='foot-from'>{1}</span>" +
            "<span class='foot-to'>{2}</span>" +
            "<span class='foot-event'>{3}</span>").format(
            lifecycle.transition, lifecycle.from, lifecycle.to, lifecycle.event));
    }
}