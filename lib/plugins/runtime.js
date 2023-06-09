/**
 * plugin的runtime，可通过e.runtime访问
 *
 * 提供一些常用的运行时变量、方法及model获取
 * 降低对目录结构的依赖
 */
import lodash from 'lodash'
import fs from 'node:fs'
import common from './adapter/common.js'
import YzMysApi from './adapter/models/YzMysApi.js'
import YzMysInfo from './adapter/models/YzMysInfo.js'
import Msg from '../components/Msg.js'
import puppeteer from '../puppeteer/puppeteer.js'

/**
 * 常用的处理方法
 */
const noV2 = function (name) {
  console.log(`e.runtime error: V2暂不支持${name}...`)
}

export default class Runtime {
  constructor (e) {
    this.e = e
    this._mysInfo = {}
  }

  static async init (e) {
    e.runtime = new Runtime(e)
    e.user = await YzMysInfo.getNoteUser(e)
    e.isV2 = true
    return e.runtime
  }

  get uid () {
    return this.user?.uid
  }

  get hasCk () {
    return this.user?.hasCk
  }

  get user () {
    return this.e.user
  }

  get cfg () {
    // v2暂不支持cfg
    return false
  }

  get gsCfg () {
    // v2暂不支持gsCfg
    return false
  }

  get common () {
    // v2暂不支持common
    return common
  }

  get puppeteer () {
    return puppeteer
  }

  /**
   * 获取MysInfo实例
   *
   * @param targetType all: 所有用户均可， cookie：查询用户必须具备Cookie
   * @returns {Promise<boolean|MysInfo>}
   */
  async getMysInfo (targetType = 'all') {
    if (!this._mysInfo[targetType]) {
      this._mysInfo[targetType] = await YzMysInfo.init(this.e, targetType === 'cookie' ? 'detail' : 'roleIndex')
    }
    return this._mysInfo[targetType]
  }

  async getUid () {
    await Msg.checkAuth(this.e, { auth: 'all' })
    let targetUser = await Msg.getTargetMysUser(this.e, { auth: 'all' });

    // 不存在查询对象，也未能识别发信息的人
    if (!targetUser) {
      // todo 待完善场景以丰富文案
      if (!e.isSendBind) {
        e.reply("请通过【#绑定+uid】命令绑定一个UID，或者私聊发送Cookie以绑定Cookie");
        e.isSendBind = true;
      }
      return false;
    }
    return targetUser.uid
  }

  /**
   * 获取MysApi实例
   *
   * @param targetType all: 所有用户均可， cookie：查询用户必须具备Cookie
   * @param option MysApi option
   * @returns {Promise<boolean|MysApi>}
   */
  async getMysApi (targetType = 'all', option = {}) {
    let mys = await this.getMysInfo(targetType)
    if (mys.uid && mys?.ckInfo?.ck) {
      return new YzMysApi(mys.uid, mys.ckInfo.ck, option)
    }
    return false
  }

  /**
   * 生成MysApi实例
   * @param uid
   * @param ck
   * @param option
   * @returns {Promise<MysApi>}
   */
  async createMysApi (uid, ck, option) {
    return new YzMysApi(uid, ck, option)
  }

  /**
   *
   * @param plugin plugin key
   * @param path html文件路径，相对于plugin resources目录
   * @param data 渲染数据
   * @param cfg 渲染配置
   * @param cfg.retType 返回值类型
   * * default/空：自动发送图片，返回true
   * * msgId：自动发送图片，返回msg id
   * * base64: 不自动发送图像，返回图像base64数据
   * @param cfg.beforeRender({data}) 可改写渲染的data数据
   * @returns {Promise<boolean>}
   */
  async render (plugin, path, data = {}, cfg = {}) {
    // 处理传入的path
    path = path.replace(/.html$/, '')
    let paths = lodash.filter(path.split('/'), (p) => !!p)
    path = paths.join('/')
    // 创建目录
    const mkdir = (check) => {
      let currDir = `${process.cwd()}/data`
      for (let p of check.split('/')) {
        currDir = `${currDir}/${p}`
        if (!fs.existsSync(currDir)) {
          fs.mkdirSync(currDir)
        }
      }
      return currDir
    }
    mkdir(`html/${plugin}/${path}`)
    // 自动计算pluResPath
    let pluResPath = `../../../${lodash.repeat('../', paths.length)}plugins/${plugin}/resources/`
    // 渲染data
    data = {
      ...data,
      _plugin: plugin,
      _htmlPath: path,
      pluResPath,
      tplFile: `./plugins/${plugin}/resources/${path}.html`,
      saveId: data.saveId || data.save_id || paths[paths.length - 1],
      pageGotoParams: {
        waitUntil: 'networkidle0'
      }
    }
    // 处理beforeRender
    if (cfg.beforeRender) {
      data = cfg.beforeRender({ data }) || data
    }
    // 保存模板数据
    if (process.argv.includes('web-debug')) {
      // debug下保存当前页面的渲染数据，方便模板编写与调试
      // 由于只用于调试，开发者只关注自己当时开发的文件即可，暂不考虑app及plugin的命名冲突
      let saveDir = mkdir(`ViewData/${plugin}`)
      let file = `${saveDir}/${data._htmlPath.split('/').join('_')}.json`
      fs.writeFileSync(file, JSON.stringify(data))
    }
    // 截图
    let base64 = await puppeteer.screenshot(`${plugin}/${path}`, data)
    if (cfg.retType === 'base64') {
      return base64
    }
    let ret = true
    if (base64) {
      ret = await this.e.reply(base64)
    }
    return cfg.retType === 'msgId' ? ret : true
  }
}
