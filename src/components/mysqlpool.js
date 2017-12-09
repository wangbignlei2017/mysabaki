var mysql=require("mysql");
var pool = mysql.createPool({
    host: 'localhost',
    user: 'user',
    password: 'password',
    database: 'database',
    port: port
});

var query=function(sql,callback){
    pool.getConnection(function(err,conn){
        if(err){
            callback(err,null,null);
        }else{
            conn.query(sql,function(qerr,vals,fields){
                //�ͷ�����
                conn.release();
                //�¼������ص�
                callback(qerr,vals,fields);
            });
        }
    });
};
module.exports=query;