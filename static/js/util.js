/**
 * 变量格式化文本
 * @param content 待变量格式化文本
 * @returns {String} 已变量格式化文本
 */
String.prototype.format = function (content) {
    var result = this;
    if (arguments.length > 0) {
        if (arguments.length == 1 && typeof (content) == "object") {
            for (var key in content) {
                if (content[key] != undefined) {
                    var reg = new RegExp("({" + key + "})", "g");
                    result = result.replace(reg, content[key]);
                }
            }
        } else {
            for (var i = 0; i < arguments.length; i++) {
                if (arguments[i] != undefined) {
                    //var reg = new RegExp("({[" + i + "]})", "g");//这个在索引大于9时会有问题
                    var reg = new RegExp("({)" + i + "(})", "g");
                    result = result.replace(reg, arguments[i]);
                }
            }
        }
    }
    return result;
};

/**
 * 驼峰格式化文本
 * @param content 待驼峰格式化文本
 * @returns {string} 已驼峰格式化文本
 */
function camelize(content) {

    if (content.length === 0)
        return content;

    var n, result, word, words = content.split(/[_-]/);

    // single word with first character already lowercase, return untouched
    if ((words.length === 1) && (words[0][0].toLowerCase() === words[0][0]))
        return content;

    result = words[0].toLowerCase();
    for (n = 1; n < words.length; n++) {
        result = result + words[n].charAt(0).toUpperCase() + words[n].substring(1).toLowerCase();
    }

    return result;
}

/**
 * 驼峰格式化前置拼接
 * @param prepend 前置拼接字符
 * @param content 待驼峰格式化文本
 * @returns {string} 已驼峰格式化文本
 */
camelize.prepended = function (prepend, content) {
    content = camelize(content);
    return prepend + content[0].toUpperCase() + content.substring(1);
};

/**
 * 数值格式化，保留两位小数
 * @param content 待格式化数值
 * @returns {string} 已数值格式化文本
 */
function formatNum(content) {
    return content.toString().match(/\d+/) + "." + (content.toString().match(/\.\d{0,2}/) * 1).toString().padEnd(4, "0").substr(2, 2);
}